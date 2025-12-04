import 'dotenv/config';

import express, { Express } from 'express';

import path from 'path';

import { fileURLToPath } from 'url';

import cors from 'cors';

import { randomUUID } from 'crypto'; // Used for better unique IDs

import { Readable } from 'stream';

import serverless from 'serverless-http';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';





// --- AWS SDK Imports ---

import db from './db.js'; // Our new DynamoDB client

import {

  PutObjectCommand,

  S3Client,

  GetObjectCommand,
  DeleteObjectCommand,

} from '@aws-sdk/client-s3';

import {

  PutCommand,

  ScanCommand,

  QueryCommandInput,
  GetCommand,
  DeleteCommand,

} from '@aws-sdk/lib-dynamodb';



// --- Fix for __dirname in ES Modules ---

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);



const app: Express = express();



// --- CORS Configuration ---

const S3_FRONTEND_URL = process.env.FRONTEND_URL || '*'; // 👈 Use a new ENV variable or set a fixed URL

const corsOptions = {

    origin: S3_FRONTEND_URL, // Setting to the actual frontend URL

    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // PUT is required for direct S3 upload

    credentials: true,

    optionsSuccessStatus: 204

};



app.use(cors(corsOptions));

app.use(express.json()); // Essential for receiving the JSON metadata in /upload-request





// --- AWS Client and Config ---

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

const s3Client = new S3Client({ region: process.env.AWS_REGION });







/* ============================

   3. Request Presigned URLs (New multi-file version)

   ============================ */

app.post('/upload-request', async (req, res) => {

    try {

        // We expect the frontend to send us the metadata AND the final S3 keys it intends to use

        const { mp3FileName, thumbFileName, voiceover_name, project_date, mp3ContentType, thumbContentType } = req.body;

       

        if (!mp3FileName || !thumbFileName || !voiceover_name || !project_date) {

             return res.status(400).json({ error: 'Missing required metadata.' });

        }



        // 1. Generate Presigned URL for MP3 (Client will use HTTP PUT)

        const mp3Command = new PutObjectCommand({

            Bucket: BUCKET_NAME,

            Key: mp3FileName,

            ContentType: mp3ContentType,

        });

        const mp3URL = await getSignedUrl(s3Client, mp3Command, { expiresIn: 300 });



        // 2. Generate Presigned URL for Thumbnail (Client will use HTTP PUT)

        const thumbCommand = new PutObjectCommand({

            Bucket: BUCKET_NAME,

            Key: thumbFileName,

            ContentType: thumbContentType,

        });

        const thumbURL = await getSignedUrl(s3Client, thumbCommand, { expiresIn: 300 });



        // 3. Save initial metadata to DynamoDB immediately (Placeholder for S3 event)

        const newId = randomUUID(); // 👈 Using the better UUID generator

        const dbParams = {

            TableName: TABLE_NAME,

            Item: {

                id: newId,

                voiceover_name: voiceover_name,

                project_date: project_date,

                date_uploaded: new Date().toISOString(),

                file_name: mp3FileName,

                thumbnail_key: thumbFileName,

               // status: 'UPLOAD_REQUESTED', // New field to track status
                status: 'COMPLETE',
            },

        };

        await db.send(new PutCommand(dbParams));

       

        // Return the secure URLs to the client for the direct S3 upload

        res.json({

            mp3URL,

            thumbURL,

            itemId: newId // Return the ID so the client can reference it if needed

        });



    } catch (err) {

        console.error('Error in /upload-request:', err);

        res.status(500).json({ error: 'Failed to generate upload links.' });

    }

});



/* ========================

   4. Stream MP3 (Refactored for S3)

   ======================== */

app.get('/stream/:filename', async (req, res) => {
  try {
    // 1. Decode the filename to handle spaces and special characters
    let encodedFilename = req.params.filename.replace(/\+/g, '%20');
    const filename = decodeURIComponent(encodedFilename);

    // Security check
    if (filename.includes('/') || filename.includes('..')) {
      return res.status(400).send('Invalid filename.');
    }

    // 2. Create the command to GET the file
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
    });

    // 3. Generate a secure, temporary URL (valid for 1 hour)
    // This is lightweight; it returns a string, not the file data.
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    // 4. Redirect the browser to S3
    // The browser will automatically follow this link and stream the MP3 from S3 directly.
    res.redirect(url);

  } catch (err) {
    console.error('Stream error:', err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});



// backend/server.ts (New route for serving thumbnails)



app.get('/thumbnail/:key', async (req, res) => {

    try {

        const key = decodeURIComponent(req.params.key); // Use the decoding fix



        const s3Params = {

            Bucket: BUCKET_NAME,

            Key: key,

        };



        const s3Object = await s3Client.send(new GetObjectCommand(s3Params));



        if (s3Object.Body instanceof Readable) {

            res.writeHead(200, {

                'Content-Type': s3Object.ContentType || 'image/jpeg',

                'Content-Length': s3Object.ContentLength,

            });

            s3Object.Body.pipe(res);

        } else {

            res.status(500).send('Error streaming image.');

        }



    } catch (err) {

        if (err instanceof Error && err.name === 'NoSuchKey') {

            return res.status(404).send('Thumbnail not found');

        }

        res.status(500).json({ error: String(err) });

    }

});



/* ==========================

   5. List All Voiceovers (Refactored for DynamoDB)

   ========================== */

app.get('/voiceovers', async (req, res) => {

  try {

    const params = {

      TableName: TABLE_NAME,

    };

    // A 'Scan' operation reads every item in the table.

    const data = await db.send(new ScanCommand(params));

    res.json(data.Items); // 'Items' contains the array of objects

  } catch (err) {

    if (err instanceof Error) {

      res.status(500).json({ error: err.message });

    } else {

      res.status(500).json({ error: String(err) });

    }

  }

});







/* ==========================================
   7. Search Voiceovers (Advanced with Date Filter)
   ========================================== */
app.get('/voiceovers/search', async (req, res) => {
  try {
    // 1. Extract all query parameters
    // We cast these to string/undefined because req.query can technically be arrays
    const q = req.query.q as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    // 2. Disable Caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Expires', '0');
    res.set('Pragma', 'no-cache');

    // 3. If NO filters are provided, return everything
    if (!q && (!startDate || !endDate)) {
      const data = await db.send(new ScanCommand({ TableName: TABLE_NAME }));
      return res.json(data.Items);
    }

    // 4. Build the Filter Expression
    const filters: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Text Filter
    if (q) {
      filters.push('(contains(#vName, :q))');
      values[':q'] = q.toLowerCase();
      names['#vName'] = 'voiceover_name';
    }

    // Date Range Filter
    if (startDate && endDate) {
      filters.push('(#pDate BETWEEN :start AND :end)');
      values[':start'] = startDate;
      values[':end'] = endDate;
      names['#pDate'] = 'project_date';
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filters.join(' AND '),
      ExpressionAttributeValues: values,
      // Only include names if we actually added some
      ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
    };

    const data = await db.send(new ScanCommand(params));
    res.json(data.Items);

  } catch (err) {
    console.error('❌ Error in /voiceovers/search route:', err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});


/* ==========================================
   8. Delete a Voiceover
   ========================================== */
// **FIX:** THIS IS NOW A SEPARATE, TOP-LEVEL ROUTE.
app.delete('/voiceover/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing voiceover ID.' });
  }

  try {
    // 1. Get the item from DynamoDB to find the file keys
    const getParams = {
      TableName: TABLE_NAME,
      Key: { id },
    };
    const data = await db.send(new GetCommand(getParams));

    if (!data.Item) {
      return res.status(404).json({ error: 'Voiceover not found.' });
    }

    const { file_name, thumbnail_key } = data.Item;

    // 2. Delete the MP3 from S3
    if (file_name) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: file_name,
      }));
    }

    // 3. Delete the Thumbnail from S3
    if (thumbnail_key) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: thumbnail_key,
      }));
    }

    // 4. Delete the item from DynamoDB
    await db.send(new DeleteCommand(getParams)); // Re-uses the same params

    res.json({ message: 'Voiceover deleted successfully!' });

  } catch (err) {
    console.error('❌ Error in /voiceover/delete route:', err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});


/* ===================
   8. Serverless Handler (Now section 9)
   =================== */
export const handler = serverless(app, {
    binary: [
        'audio/mpeg',
        'audio/mp3',
        'image/*', // Added for thumbnail route
        '*/*',
    ],
});