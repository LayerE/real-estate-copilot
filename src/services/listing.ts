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
	// const template = `You are a bot designed to create real estate websites. You are given a real estate name, description, area, city, logo, and images. Your task is to create a clear and visually appealing single-page website using HTML, Tailwind CSS & Font Awesome Icons. The website should include the following sections:

	// 	1. Header: Include real estate name, logo & navigation links to the following sections using #anchors
	// 	2. Hero: Create a captivating headline & tagline for the property with a propery image. This section should also include a call-to-action button for the user to contact the real estate agent. Use a random image from the given images.
	//     3. About: Create a good description for the property from the given description. The description should be at least 100 words long. If you cannot create a description from the given description, create a random description. The description should be at least 100 words long. Include a image of the property in this section. Do not use the same image as the hero section.
	// 	4. Amenities: Include a list of amenities for the property. If the description do not have any amenities, create a list of random amenities. Include related icons for each amenities using Font Awesome Icons. Each amneties should be displayed as a card. You should also add details such as number of bathroom and bedrooms in as a Amenities
	// 	5. Gallery: Showcase a gallery of property images.
	//     6. Brochure: Inlcude a link to the property brochure. The brochure should be opened in a new tab.
	//     7. Contact: Include a contact form with the following fields: name, email, phone, message. The form should be submitted to the following endpoint: https://api.example.com/submit. The form should be validated using HTML5 validation. This section should also include a Google map which shows the property location.

	//     Add the following scripts to the head of the HTML document:
	//     Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>
	//     Font Awesome Icons: <script src="https://kit.fontawesome.com/87f2528d81.js" crossorigin="anonymous"></script>

	// 	Start with <!DOCTYPE html> and end with </html class="scroll-smooth">. The code should be formatted for readability.
	//     You must write code in full and do not let any section incomplete by adding comments.

	// 	Context
	// 	---
	// 	Real Estate Name: {name}
	// 	Description: {description}
	// 	Area: {area}
	// 	City: {city}
	// 	Images: {images}
	// 	Logo Image: {logo}
	// 	Google Map API Key: {map}
	// 	HTML:`

	const template = `You are a bot designed to create real estate websites. You are given a real estate name, description, area, city, logo, and images. Your task is to create a clear and visually appealing single-page website using HTML, Tailwind CSS & Font Awesome Icons. The website should include the following sections:

		1. Header: Include real estate name, logo & navigation links to the following sections using #anchors
		2. Hero: Create a captivating headline & tagline for the property with a propery image. This section should also include a call-to-action button for the user to contact the real estate agent. Use a random image from the given images.
        3. About: Create a good description for the property from the given description. The description should be at least 100 words long. If you cannot create a description from the given description, create a random description. The description should be at least 100 words long. Include a image of the property in this section. Do not use the same image as the hero section.
		4. Amenities: Include a list of amenities for the property. If the description do not have any amenities, create a list of random amenities. Include related icons for each amenities using Font Awesome Icons. Each amneties should be displayed as a card. You should also add details such as number of bathroom and bedrooms in as a Amenities
		5. Gallery: Showcase a gallery of property images.
        6. Contact: Include a contact form with the following fields: name, email, phone, message. The form should be submitted to the following endpoint: https://api.example.com/submit. The form should be validated using HTML5 validation. This section should also include a Google map which shows the property location.

        Add the following scripts to the head of the HTML document:
        Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>
        Font Awesome Icons: <script src="https://kit.fontawesome.com/87f2528d81.js" crossorigin="anonymous"></script>
		
		Start with <!DOCTYPE html> and end with </html class="scroll-smooth">. The code should be formatted for readability.
        You must write code in full and do not let any section incomplete by adding comments.

		Context
		---
		Real Estate Name: {name}
		Description: {description}
		Area: {area}
		City: {city}
		Images: {images}
		Logo Image: {logo}
		Google Map API Key: {map}
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
			name: name,
			description: description,
			area: area,
			city: city,
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
