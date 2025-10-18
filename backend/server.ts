// backend/server.ts

import express, { Express, Request } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';

const db = require('./db');
const cors = require('cors');

const app: Express = express();
app.use(express.json());

// enable CORS for frontend
app.use(cors());

/* ====================
   1. Serve Frontend
   ==================== */
app.use(express.static(path.join(__dirname, '../frontend')));

/* ====================
   2. File Upload Setup
   ==================== */
const uploadDir = path.join(__dirname, 'uploads');

const storage = multer.diskStorage({
  destination: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) => {
    cb(null, uploadDir);
  },
  filename: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

// Optional: filter only audio files
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void => {
  if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
    cb(null, true);
  } else {
    cb(new Error('Only MP3 files are allowed'));
  }
};

// Limit uploads to 10 MB
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ============================
   3. Upload MP3 & Save to DB
   ============================ */
app.post('/upload', upload.single('voiceover'), async (req, res) => {
  try {
    const { voiceover_name, project_date } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const file_name = req.file.filename;

    await db.query(
      'INSERT INTO voiceover (voiceover_name, project_date, date_uploaded, file_name) VALUES (?, ?, NOW(), ?)',
      [voiceover_name, project_date, file_name]
    );
    res.json({ message: 'Voiceover uploaded successfully!' });
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

/* ========================
   4. Stream MP3 files safely
   ======================== */
app.get('/stream/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    fs.stat(
      filePath,
      (err: NodeJS.ErrnoException | null, stat: fs.Stats | undefined) => {
        if (err || !stat) return res.status(500).send(err?.message);

        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          const stream = fs.createReadStream(filePath, { start, end });
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'audio/mpeg',
          });
          stream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'audio/mpeg',
          });
          fs.createReadStream(filePath).pipe(res);
        }
      }
    );
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

/* ==========================
   5. List All Voiceovers
   ========================== */
app.get('/voiceovers', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM voiceover');
    res.json(rows);
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

/* ==========================================
   6. Filter Voiceovers by Category (optional)
   ========================================== */
app.get('/voiceovers/category/:id', async (req, res) => {
  try {
    const categoryId = req.params.id;
    const sql = `
      SELECT v.* 
      FROM voiceover v
      JOIN category_has_voiceover cv ON v.voiceover_id = cv.voiceover_id
      WHERE cv.category_id = ?
    `;
    const [rows] = await db.query(sql, [categoryId]);
    res.json(rows);
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

/* ==========================================
   7. Search Voiceovers by Name or Description
   ========================================== */

app.get('/voiceovers/search', async (req, res) => {
  try {
    const { q } = req.query;
    console.log('🔎 Search query received:', q);

    // If no search term provided, return all voiceovers
    if (!q) {
      console.log('No search query, returning all voiceovers.');
      const [rows] = await db.query('SELECT * FROM voiceover');
      console.log('Returned', rows.length, 'voiceovers');
      return res.json(rows);
    }

    const searchTerm = `%${q}%`;

    // Check if 'description' column exists in table
    const [columns]: any = await db.query(
      "SHOW COLUMNS FROM voiceover LIKE 'description'"
    );
    const hasDescription = columns.length > 0;

    // Build SQL depending on whether description exists
    let sql: string;
    let params: any[];
    if (hasDescription) {
      sql = `
        SELECT * 
        FROM voiceover 
        WHERE voiceover_name LIKE ? OR description LIKE ?
      `;
      params = [searchTerm, searchTerm];
    } else {
      sql = `
        SELECT * 
        FROM voiceover 
        WHERE voiceover_name LIKE ?
      `;
      params = [searchTerm];
    }

    const [rows] = await db.query(sql, params);
    console.log('✅ Search results:', rows.length, 'matches');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error in /voiceovers/search route:', err);
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

/* ==========================
   8. Auto-sync uploads to DB
   ========================== */
async function syncUploads() {
  try {
    const files = fs.readdirSync(uploadDir).filter((f) => f.endsWith('.mp3'));

    for (const file of files) {
      const [rows] = await db.query(
        'SELECT * FROM voiceover WHERE file_name = ?',
        [file]
      );

      if (rows.length === 0) {
        console.log(`Adding new file to DB: ${file}`);
        await db.query(
          'INSERT INTO voiceover (voiceover_name, date_uploaded, project_date, file_name) VALUES (?, NOW(), NOW(), ?)',
          [path.parse(file).name, file]
        );
      }
    }

    console.log('✅ Uploads synced to DB');
  } catch (err) {
    if (err instanceof Error) {
      console.error('❌ Error syncing uploads:', err.message);
    } else {
      console.error('❌ Unknown error syncing uploads:', err);
    }
  }
}

/* ===================
   9. Start the server
   =================== */
app.listen(3000, async () => {
  console.log('Server running on port 3000');
  await syncUploads(); // auto-sync uploads after server starts
});
