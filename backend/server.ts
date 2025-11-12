
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
} from '@aws-sdk/client-s3';
import {
  PutCommand,
  ScanCommand,
  QueryCommandInput,
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

/* ====================
   1. Serve Frontend (Unchanged)
   ==================== */
app.use(express.static(path.join(__dirname, '../frontend')));

/* ====================
   2. File Upload Setup (REMOVED: Multer logic is gone)
   ==================== */

/* ============================
   3. Request Presigned URLs (New multi-file version)
   ============================ */
app.post('/upload-request', async (req, res) => {
    try {
        // We expect the frontend to send us the metadata AND the final S3 keys it intends to use
        const { mp3FileName, thumbFileName, voiceover_name, project_date } = req.body;
        
        if (!mp3FileName || !thumbFileName || !voiceover_name || !project_date) {
             return res.status(400).json({ error: 'Missing required metadata.' });
        }

        // 1. Generate Presigned URL for MP3 (Client will use HTTP PUT)
        const mp3Command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: mp3FileName,
            ContentType: 'audio/mpeg',
        });
        const mp3URL = await getSignedUrl(s3Client, mp3Command, { expiresIn: 300 });

        // 2. Generate Presigned URL for Thumbnail (Client will use HTTP PUT)
        const thumbCommand = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: thumbFileName,
            ContentType: 'image/*',
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
                status: 'UPLOAD_REQUESTED', // New field to track status
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
    let encodedFilename = req.params.filename.replace(/\+/g, '%20');

    const filename = decodeURIComponent(encodedFilename);

    // Check if the file has any slashes (to avoid directory traversal)
    if (filename.includes('/') || filename.includes('..')) {
      return res.status(400).send('Invalid filename.');
    }

    const s3Params = {
      Bucket: BUCKET_NAME,
      Key: filename,
    };

    const s3Object = await s3Client.send(new GetObjectCommand(s3Params));

    // --- THIS IS THE FIX ---
    // Check if the body exists and is an instance of a readable stream
    if (s3Object.Body instanceof Readable) {
      // Set headers for streaming audio
      res.writeHead(200, {
        'Content-Type': s3Object.ContentType || 'audio/mpeg',
        'Content-Length': s3Object.ContentLength || 0,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `inline; filename="${req.params.filename}"`,
      });

      // Pipe the S3 stream directly to the response
      s3Object.Body.pipe(res);
    } else {
      // Handle the case where the body isn't a stream
      throw new Error('S3 object body is not a readable stream.');
    }
    // --- END FIX ---

  } catch (err) {
    // Handle "NoSuchKey" error if file not found in S3
    if (err instanceof Error && err.name === 'NoSuchKey') {
      return res.status(404).send('File not found');
    }
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
   7. Search Voiceovers (Refactored for DynamoDB)
   ========================================== */
app.get('/voiceovers/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      // If no query, just return all (same as /voiceovers)
      const data = await db.send(new ScanCommand({ TableName: TABLE_NAME }));
      return res.json(data.Items);
    }

    const searchTerm = String(q).toLowerCase();

    // In DynamoDB, 'Scan' is less efficient for search as it reads all items.
    // A better way is using a full-text search service like OpenSearch,
    // but for a small app, a Scan with a FilterExpression is fine.
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      FilterExpression:
        'contains(voiceover_name, :q) OR contains(description, :q)', // Assuming 'description' might exist
      ExpressionAttributeValues: {
        ':q': searchTerm,
      },
    };

    // We'll have to adjust if 'description' doesn't exist.
    // For simplicity, let's just search 'voiceover_name'
    const simpleParams = {
      TableName: TABLE_NAME,
      FilterExpression: 'contains(voiceover_name, :q)',
      ExpressionAttributeValues: {
        ':q': searchTerm,
      },
    };

    const data = await db.send(new ScanCommand(simpleParams));
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


/* ===================
   8. Serverless Handler
   =================== */
export const handler = serverless(app, {
    binary: [
        'audio/mpeg',
        'audio/mp3',
        'image/*', // Added for thumbnail route
        '*/*', 
    ],
});
