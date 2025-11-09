// backend/server.ts
import 'dotenv/config'; // Make sure dotenv is loaded first
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { randomUUID } from 'crypto'; // To create unique IDs
import { Readable } from 'stream';
import serverless from 'serverless-http';
// --- AWS SDK Imports ---
import db from './db.js'; // Our new DynamoDB client
import { PutObjectCommand, S3Client, GetObjectCommand, } from '@aws-sdk/client-s3';
import { PutCommand, ScanCommand, } from '@aws-sdk/lib-dynamodb';
// --- Fix for __dirname in ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const corsOptions = {
    origin: '*', // 👈 REPLACE with your actual S3 endpoint
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // If you need cookies/auth later
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json());
// --- AWS Client and Config ---
const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const s3Client = new S3Client({ region: process.env.AWS_REGION });
/* ====================
   1. Serve Frontend (Unchanged)
   ==================== */
app.use(express.static(path.join(__dirname, '../frontend')));
/* ====================
   2. File Upload Setup (Changed)
   ==================== */
// We now use 'memoryStorage' to process the file in memory, not save it to disk.
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
        cb(null, true);
    }
    else {
        cb(new Error('Only MP3 files are allowed'));
    }
};
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
});
/* ============================
   3. Upload MP3 (Refactored for S3 & DynamoDB)
   ============================ */
app.post('/upload', upload.single('voiceover'), async (req, res) => {
    try {
        const { voiceover_name, project_date } = req.body;
        if (!req.file)
            return res.status(400).json({ error: 'No file uploaded' });
        // 1. Create a unique filename
        const file_name = `${Date.now()}-${req.file.originalname}`;
        // 2. Upload the file to S3
        const s3Params = {
            Bucket: BUCKET_NAME,
            Key: file_name, // The name of the file in S3
            Body: req.file.buffer, // The actual file data from multer
            ContentType: 'audio/mpeg',
        };
        await s3Client.send(new PutObjectCommand(s3Params));
        // 3. Save metadata to DynamoDB
        const newId = randomUUID();
        const dbParams = {
            TableName: TABLE_NAME,
            Item: {
                id: newId, // Our new UUID partition key
                voiceover_name: voiceover_name,
                project_date: project_date,
                date_uploaded: new Date().toISOString(),
                file_name: file_name, // The S3 key
            },
        };
        await db.send(new PutCommand(dbParams));
        res.json({ message: 'Voiceover uploaded successfully!' });
    }
    catch (err) {
        if (err instanceof Error) {
            res.status(500).json({ error: err.message });
        }
        else {
            res.status(500).json({ error: String(err) });
        }
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
        }
        else {
            // Handle the case where the body isn't a stream
            throw new Error('S3 object body is not a readable stream.');
        }
        // --- END FIX ---
    }
    catch (err) {
        // Handle "NoSuchKey" error if file not found in S3
        if (err instanceof Error && err.name === 'NoSuchKey') {
            return res.status(404).send('File not found');
        }
        if (err instanceof Error) {
            res.status(500).json({ error: err.message });
        }
        else {
            res.status(500).json({ error: String(err) });
        }
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
    }
    catch (err) {
        if (err instanceof Error) {
            res.status(500).json({ error: err.message });
        }
        else {
            res.status(500).json({ error: String(err) });
        }
    }
});
/* ==========================================
   6. Filter by Category (Refactored for DynamoDB)
   ========================================== */
// NOTE: Joining tables isn't a concept in DynamoDB.
// This would require a different data model, e.g., adding a 'categoryId'
// attribute to the main 'Voiceovers' table.
// For now, this route will be difficult to implement without a
// schema change. This is a key difference from SQL.
// I've left this commented out as it requires a deeper design choice.
/*
app.get('/voiceovers/category/:id', async (req, res) => {
  // To do this in DynamoDB, you'd likely use a Global Secondary Index (GSI)
  // on 'category_id' and query that index.
  res.status(501).json({ message: 'Not implemented for DynamoDB yet' });
});
*/
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
        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'contains(voiceover_name, :q) OR contains(description, :q)', // Assuming 'description' might exist
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
    }
    catch (err) {
        console.error('❌ Error in /voiceovers/search route:', err);
        if (err instanceof Error) {
            res.status(500).json({ error: err.message });
        }
        else {
            res.status(500).json({ error: String(err) });
        }
    }
});
/* ===================
   8. Start the server (Sync removed)
   =================== */
const PORT = process.env.PORT || 3000; // Use the environment variable, default to 3000
export const handler = serverless(app, {
    binary: [
        'audio/mpeg',
        'audio/mp3',
        '*/*', // Catch-all for safety, but audio/mpeg is the focus
    ],
});
//not sure if we'll need this again:
/*app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
  console.log('Using S3 Bucket:', BUCKET_NAME);
  console.log('Using DynamoDB Table:', TABLE_NAME);
});*/ 
