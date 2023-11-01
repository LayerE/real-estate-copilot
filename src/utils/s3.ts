import { S3_BUCKET } from '../env'
import { s3 } from '../config'
import { ListObjectsCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'

async function uploadToS3(buffer: Buffer, key: string) {
	const params = {
		Bucket: S3_BUCKET,
		Key: key,
		Body: buffer
	}
	await s3.send(new PutObjectCommand(params))
}

async function deleteAllObjects() {
	const params = {
		Bucket: S3_BUCKET
	}
	const data = await s3.send(new ListObjectsCommand(params))
	const objects = data.Contents
	if (objects) {
		const deleteParams = {
			Bucket: S3_BUCKET,
			Delete: { Objects: objects.map(({ Key }) => ({ Key })) }
		}
		await s3.send(new DeleteObjectsCommand(deleteParams))
	}
}

export { uploadToS3, deleteAllObjects }
