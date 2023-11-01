import * as aws from '@aws-sdk/client-s3'
import { S3_ACCESS_KEY, S3_ENDPOINT, S3_SECRET_KEY } from '../env'

const s3 = new aws.S3({
	apiVersion: '2006-03-01',
	region: 'auto',
	endpoint: S3_ENDPOINT,
	credentials: {
		accessKeyId: S3_ACCESS_KEY as string,
		secretAccessKey: S3_SECRET_KEY as string
	}
})

export { s3 }
