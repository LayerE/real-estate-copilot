import { Handler } from 'express'
import { generateHtml, getAllListings, getListingById, uploadListingImages } from '../services'
import { errorRequestHandler } from '../utils'
import formidable from 'formidable'

const previewListingHandler: Handler = async (req, res) => {
	try {
		const { id } = req.params
		const listing = await getListingById(id)
		if (!listing) return res.sendStatus(404)
		res.setHeader('Content-Type', 'text/html')
		res.send(listing.html)
	} catch (err) {
		errorRequestHandler(err, res)
	}
}

const getlistingHandler: Handler = async (req, res) => {
	try {
		const { id } = req.params
		const { user } = req.body
		const listing = await getListingById(id)
		if (!listing || listing.userId !== user) return res.status(404).json({ error: 'Listing not found' })
		res.json(listing)
	} catch (err) {
		errorRequestHandler(err, res)
	}
}

const getAllListingHandler: Handler = async (req, res) => {
	try {
		const { user } = req.body
		const listings = await getAllListings(user)
		res.json(listings)
	} catch (err) {
		errorRequestHandler(err, res)
	}
}

const createListingHandler: Handler = async (req, res) => {
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
		if (!images) return res.status(400).json({ error: 'Invalid File or no images' })
		if (!logo) return res.status(400).json({ error: 'Invalid File or no logo' })

		const { name, description, area, city } = fields
		if (!name || !description || !area || !city) return res.status(400).json({ error: 'Invalid Fields' })

		const { images: imageUrls, logo: logoUrl } = await uploadListingImages(images, logo)

		await generateHtml(name[0], description[0], area[0], city[0], logoUrl, imageUrls, user, res)
	} catch (err) {
		errorRequestHandler(err, res)
	}
}

export { createListingHandler, previewListingHandler, getlistingHandler, getAllListingHandler }
