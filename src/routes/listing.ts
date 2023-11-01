import { Router } from 'express'
import { getAllListingHandler, getlistingHandler, previewListingHandler, createListingHandler } from '../controllers'
import { isAuth } from '../middlewares'

const router = Router()

router.get('/preview/:id', previewListingHandler)
router.get('/:id', isAuth, getlistingHandler)
router.get('/', isAuth, getAllListingHandler)
router.post('/create', isAuth, createListingHandler)

export default router
