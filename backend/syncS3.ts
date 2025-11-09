// backend/syncS3.ts

import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from 'uuid';

// IMPORTANT: This uses the DynamoDB Document Client, which is typically easier 
// to work with than the generic DynamoDBClient, but either works.
const client = new DynamoDBClient({}); 
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'Voiceovers';

// The handler signature for an S3 event is different from an API Gateway event
export const handler = async (event: any) => {
    console.log('Received S3 event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        // Extract file details from the S3 event record
        const s3ObjectKey = record.s3.object.key;
        const bucketName = record.s3.bucket.name;
        
        // Example: If file is "my-voiceover.mp3", voiceover_name is assumed to be "my-voiceover"
        const voiceoverName = s3ObjectKey.replace('.mp3', '').replace('-', ' ');

        const command = new PutItemCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Item: {
                id: { S: uuidv4() },
                file_name: { S: s3ObjectKey },
                voiceover_name: { S: voiceoverName },
                project_date: { S: new Date().toISOString().split('T')[0] }, // Today's date
                date_uploaded: { S: new Date().toISOString() },
            },
        });

        try {
            await client.send(command);
            console.log(`Successfully synced ${s3ObjectKey} to DynamoDB.`);
        } catch (error) {
            console.error(`Error syncing ${s3ObjectKey} to DynamoDB:`, error);
            // Throwing the error will allow Lambda to retry the event if needed
            throw error; 
        }
    }

    return { statusCode: 200, body: 'S3 files processed' };
};