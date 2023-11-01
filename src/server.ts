import { config } from 'dotenv'
config()
import { PORT } from './env'

import express, { ErrorRequestHandler } from 'express'
import cors from 'cors'
import { listingRoutes } from './routes'

const app = express()
app.use(cors())
app.use(express.json())

const invalidJsonChecker: ErrorRequestHandler = (err, req, res, next) => {
	if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
		return res.status(400).json({ error: 'Invalid JSON' })
	}

	next()
}

app.use(invalidJsonChecker)

app.use('/listing', listingRoutes)

app.listen(PORT || 3000, () => {
	console.log(`Server listening on port ${PORT || 3000}`)
})
