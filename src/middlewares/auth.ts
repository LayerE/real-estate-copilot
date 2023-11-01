import { Handler } from 'express'
import jwt from 'jsonwebtoken'
import { CLERK_PUBLIC_KEY } from '../env'

const isAuth: Handler = async (req, res, next) => {
	if (!req.headers['authorization']) return res.status(400).json({ error: 'Authorization key not provided' })
	const token = req.headers['authorization'].split(' ')[1]
	try {
		const decoded = jwt.verify(token, CLERK_PUBLIC_KEY as string)
		if (!decoded.sub) {
			return res.status(400).json({ error: 'Invalid authorization token' })
		}
		req.body.user = decoded.sub
		next()
	} catch (err) {
		return res.status(400).json({ error: 'Invalid authorization token' })
	}
}

export { isAuth }
