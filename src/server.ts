import { config } from 'dotenv'
config()

import express, { ErrorRequestHandler, Handler } from 'express'
import cors from 'cors'
import formidable from 'formidable'
import * as aws from '@aws-sdk/client-s3'
import { readFileSync, writeFileSync } from 'fs'
import sharp from 'sharp'
import { OpenAI } from 'langchain/llms/openai'
import { PromptTemplate } from 'langchain/prompts'
import { LLMChain } from 'langchain/chains'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, PORT, S3_BUCKET, S3_PUBLIC_URL, OPENAI_API_KEY, CLERK_PUBLIC_KEY, MAP_API_KEY } =
	process.env

if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET || !S3_PUBLIC_URL) {
	throw new Error('Missing S3 Credentials')
}

if (!OPENAI_API_KEY) {
	throw new Error('Missing OpenAI API Key')
}

if (!CLERK_PUBLIC_KEY) {
	throw new Error('Missing Clerk Public Key')
}

if (!MAP_API_KEY) {
	throw new Error('Missing Map API Key')
}

const prisma = new PrismaClient()

const s3 = new aws.S3({
	apiVersion: '2006-03-01',
	region: 'auto',
	endpoint: S3_ENDPOINT,
	credentials: {
		accessKeyId: S3_ACCESS_KEY as string,
		secretAccessKey: S3_SECRET_KEY as string
	}
})

const model = new OpenAI({
	modelName: 'gpt-4',
	streaming: true
})

async function uploadToS3(buffer: Buffer, key: string) {
	const params = {
		Bucket: S3_BUCKET,
		Key: key,
		Body: buffer
	}
	await s3.send(new aws.PutObjectCommand(params))
}

async function deleteAllObjects() {
	const params = {
		Bucket: S3_BUCKET
	}
	const data = await s3.send(new aws.ListObjectsCommand(params))
	const objects = data.Contents
	if (objects) {
		const deleteParams = {
			Bucket: S3_BUCKET,
			Delete: { Objects: objects.map(({ Key }) => ({ Key })) }
		}
		await s3.send(new aws.DeleteObjectsCommand(deleteParams))
	}
}

const isAuth: Handler = async (req, res, next) => {
	if (!req.headers['authorization']) return res.status(400).json({ error: 'Authorization key not provided' })
	const token = req.headers['authorization'].split(' ')[1]
	try {
		const decoded = jwt.verify(token, CLERK_PUBLIC_KEY)
		req.body.user = decoded.sub
		console.log(req.body.user)
		next()
	} catch (err) {
		return res.status(400).json({ error: 'Invalid authorization token' })
	}
}

const app = express()
app.use(cors())
app.use(express.json())

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
	if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
		return res.status(400).json({ error: 'Invalid JSON' })
	}

	next()
}

app.use(errorHandler)

app.post('/create', isAuth, async (req, res) => {
	try {
		const { user } = req.body
		const form = formidable({
			filter: ({ mimetype }) => {
				if (!mimetype) return false
				return ['image/png', 'image/jpeg'].includes(mimetype)
			},
			multiples: true,
			keepExtensions: true
		})

		let files: formidable.Files
		let fields: formidable.Fields

		try {
			;[fields, files] = await form.parse(req)
		} catch (err: any) {
			return res.status(400).json({ error: err.message })
		}

		const images = files?.image
		const logo = files?.logo
		if (!images || !logo) return res.status(400).json({ error: 'Invalid File' })

		const { name, description, area, city } = fields
		if (!name || !description || !area || !city) return res.status(400).json({ error: 'Invalid Fields' })

		const promise = images.map(async ({ filepath, newFilename }) => {
			const file = readFileSync(filepath)
			const metadata = await sharp(file).metadata()
			const key = metadata.width + 'x' + metadata.height + '/' + newFilename
			await uploadToS3(file, key)
			return S3_PUBLIC_URL + '/' + key
		})

		const logoFile = readFileSync(logo[0].filepath)
		const logoMetadata = await sharp(logoFile).metadata()
		const logoKey = logoMetadata.width + 'x' + logoMetadata.height + '/' + logo[0].newFilename
		await uploadToS3(logoFile, logoKey)
		const logoUrl = S3_PUBLIC_URL + '/' + logoKey
		const imagesData = await Promise.all(promise)

		const template = `As a UI designer specializing in real estate-specific websites, your task is to create a clear and visually appealing HTML UI using Tailwind CSS. This UI component is designed for a single-page real estate listing website. Please design a UI component that includes the following real estate-specific elements:

		1. Header Section: Include real estate name, logo & navigation links to the following sections using #anchors
		2. Hero Section: Create a captivating headline & description for the property with a propery image. This section should also include a call-to-action button for the user to contact the real estate agent. Use a random image from the following list: {images}
		3. Details Section: Include a section that displays the property details, such as price, location, area, number of bedrooms, number of bathrooms. Each detail should be displayed inside a card and the cards should be displayed in flex row. include icons for each detail using fontawesome icons.
		4. Gallery Section: Showcase a gallery of property images.
		5. Location Section: Include a map that displays the property location.
		
		Please ensure the HTML code is valid and properly structured, incorporating the necessary CDN links for Tailwind CSS, Fontawesome icons, jQuery, Animate.css, Google Maps API, and any additional CSS or JS files.
		
		Remember to keep the design minimalistic, intuitive, and visually appealing. Your attention to detail is highly appreciated. Once you complete the design, provide the HTML code for the UI component. The code should be valid HTML, formatted for readability, and include the necessary CDN links for Tailwind CSS, icons, and any additional libraries used for data visualization.
		
		Start with <!DOCTYPE html> and end with </html>. The code should be formatted for readability.
		body tag should include the "scroll-smooth" class from tailwind.
		you should never write comments in the code & always complete all the sections.
		
		Context
		---
		Real Estate Name: {name}
		Description: {description}
		Area: {area}
		City: {city}
		Images: {images}
		Logo Image: {logo}
		Map API Key: {map}
		HTML:`

		const prompt = new PromptTemplate({
			template,
			inputVariables: ['name', 'description', 'area', 'city', 'images', 'map', 'logo']
		})

		const chain = new LLMChain({
			llm: model,
			prompt
		})

		res.setHeader('Content-Type', 'text/event-stream')

		const html = await chain.call(
			{
				name: name[0],
				description: description[0],
				area: area[0],
				city: city[0],
				images: JSON.stringify(imagesData),
				map: MAP_API_KEY,
				logo: logoUrl
			},
			[
				{
					handleLLMNewToken(token: string) {
						res.write(`data: ${JSON.stringify({ token })}\n\n`)
					},
					handleLLMEnd: async function (data) {
						const answer = data.generations[0][0].text
						res.end()
					}
				}
			]
		)

		const begin = html.text.indexOf('<!DOCTYPE html>')
		const end = html.text.indexOf('</html>')
		const sanitized = html.text.slice(begin, end + 7)

		await prisma.listing.create({
			data: {
				name: name[0],
				description: description[0],
				area: area[0],
				city: city[0],
				Image: {
					createMany: {
						data: imagesData.map((url) => ({ url }))
					}
				},
				userId: user,
				html: sanitized
			}
		})
	} catch (err) {
		console.log(err)
		res.status(500).json({ error: 'Something went wrong' })
	}
})

app.get('/listings', isAuth, async (req, res) => {
	try {
		const { user } = req.body
		const listings = await prisma.listing.findMany({
			include: {
				Image: true
			},
			where: {
				userId: user
			}
		})
		res.json(listings)
	} catch (err) {
		console.log(err)
		res.status(500).json({ error: 'Something went wrong' })
	}
})

app.get('/listings/:id', isAuth, async (req, res) => {
	try {
		const { id } = req.params
		const { user } = req.body

		console.log(id, user)
		const listing = await prisma.listing.findUnique({
			where: {
				id_userId: {
					id,
					userId: user
				}
			},
			include: {
				Image: true
			}
		})
		if (!listing) return res.status(404).json({ error: 'Listing not found' })
		res.json(listing)
	} catch (err) {
		console.log(err)
		res.status(500).json({ error: 'Something went wrong' })
	}
})

app.get('/preview/:id', async (req, res) => {
	try {
		const listing = await prisma.listing.findUnique({
			where: {
				id: req.params.id
			},
			select: {
				html: true
			}
		})
		if (!listing) return res.sendStatus(404)
		res.setHeader('Content-Type', 'text/html')
		res.send(listing.html)
	} catch {
		res.status(500).json({ error: 'Something went wrong' })
	}
})

app.listen(PORT || 3000, () => {
	console.log(`Server listening on port ${PORT || 3000}`)
})

// deleteAllObjects()
