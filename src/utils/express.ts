import { Response } from 'express'

class HTTPException extends Error {
	constructor(public status: number, public message: string) {
		super(message)
		this.status = status
		this.name = this.constructor.name
	}
}

const errorRequestHandler = (err: any, res: Response) => {
	console.error(err)
	if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
		return res.status(400).json({ error: 'Invalid JSON' })
	}

	if (err instanceof HTTPException) {
		return res.status(err.status).json({ error: err.message })
	}

	res.status(500).json({ error: 'Something went wrong' })
}

export { HTTPException, errorRequestHandler }
