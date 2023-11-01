import formidable from 'formidable'
import { prisma } from '../config'
import { BE_URL, S3_PUBLIC_URL } from '../env'
import { readFileSync } from 'fs'
import { uploadToS3 } from '../utils'
import { Response } from 'express'
import { OpenAI } from 'langchain/llms/openai'
import { PromptTemplate } from 'langchain/prompts'
import { LLMChain } from 'langchain/chains'
import { MAP_API_KEY } from '../env'

const model = new OpenAI({
	modelName: 'gpt-4',
	streaming: true
})

const createListing = async (
	name: string,
	description: string,
	area: string,
	city: string,
	logo: string,
	images: string[],
	user: string,
	html: string
) =>
	await prisma.listing.create({
		data: {
			name,
			description,
			area,
			city,
			Image: {
				createMany: {
					data: images.map((key) => ({ key }))
				}
			},
			logo,
			userId: user,
			html
		}
	})

const getAllListings = async (user: string) =>
	await prisma.listing.findMany({
		where: {
			userId: user
		}
	})

const getListingById = async (id: string) => {
	const listing = await prisma.listing.findUnique({
		where: {
			id
		},
		include: {
			Image: true
		}
	})

	if (!listing) return null

	const { name, description, area, city, Image, logo, html, userId } = listing

	return {
		name,
		description,
		area,
		city,
		images: Image.map(({ key }) => `${S3_PUBLIC_URL}/${key}`),
		logo,
		html,
		userId
	}
}

const uploadListingImages = async (images: formidable.File[], logo: formidable.File[]) => {
	const promise = images.map(async ({ filepath, newFilename }) => {
		const file = readFileSync(filepath)
		const key = newFilename
		await uploadToS3(file, key)
		return key
	})

	const logoFile = readFileSync(logo[0].filepath)
	const logoKey = logo[0].newFilename
	await uploadToS3(logoFile, logoKey)
	const imagesData = await Promise.all(promise)

	return {
		images: imagesData.map((key) => `${S3_PUBLIC_URL}/${key}`),
		logo: `${S3_PUBLIC_URL}/${logoKey}`
	}
}

const generateHtml = async (
	name: string,
	description: string,
	area: string,
	city: string,
	logo: string,
	images: string[],
	user: string,
	res: Response
) => {
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
			images: JSON.stringify(images),
			map: MAP_API_KEY,
			logo
		},
		[
			{
				handleLLMNewToken(token: string) {
					res.write(`data: ${JSON.stringify({ token })}\n\n`)
				},
				handleLLMEnd: async function (data) {
					const html = data.generations[0][0].text
					const begin = html.indexOf('<!DOCTYPE html>')
					const end = html.indexOf('</html>')
					const sanitized = html.slice(begin, end + 7)
					const listing = await createListing(name, description, area, city, logo, images, user, sanitized)
					res.write(`data: ${JSON.stringify({ id: listing.id, preview: `${BE_URL}/listing/preview/${listing.id}` })}\n\n`)
					res.end()
				}
			}
		]
	)
}

export { createListing, getAllListings, getListingById, uploadListingImages, generateHtml }
