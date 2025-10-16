"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
//import multer from 'multer';
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
//const fs = require('fs');
const db = require('./db');
const cors = require('cors');
const app = (0, express_1.default)();
app.use(express_1.default.json());
//enable CORS for frontend
app.use(cors());
/* ====================
   1. Serve Frontend
   ==================== */
app.use(express_1.default.static(path_1.default.join(__dirname, '../frontend')));
/* ====================
   2. File Upload Setup
   ==================== */
const uploadDir = path_1.default.join(__dirname, 'uploads');
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    },
});
// Optional: filter only audio files
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
        cb(null, true);
    }
    else {
        cb(new Error('Only MP3 files are allowed'));
    }
};
// Limit uploads to 10 MB
const upload = (0, multer_1.default)({
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
        if (!req.file)
            return res.status(400).json({ error: 'No file uploaded' });
        const file_name = req.file.filename;
        await db.query('INSERT INTO voiceover (voiceover_name, project_date, date_uploaded, file_name) VALUES (?, ?, NOW(), ?)', [voiceover_name, project_date, file_name]);
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
   4. Stream MP3 files safely
   ======================== */
app.get('/stream/:filename', (req, res) => {
    try {
        const filename = path_1.default.basename(req.params.filename);
        const filePath = path_1.default.join(uploadDir, filename);
        if (!fs_1.default.existsSync(filePath))
            return res.status(404).send('File not found');
        fs_1.default.stat(filePath, (err, stat) => {
            if (err || !stat)
                return res.status(500).send(err?.message);
            const fileSize = stat.size;
            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = end - start + 1;
                const stream = fs_1.default.createReadStream(filePath, { start, end });
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'audio/mpeg',
                });
                stream.pipe(res);
            }
            else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'audio/mpeg',
                });
                fs_1.default.createReadStream(filePath).pipe(res);
            }
        });
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
/* ==========================
   5. List All Voiceovers
   ========================== */
app.get('/voiceovers', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM voiceover');
        res.json(rows);
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
/* ==========================
   7. Auto-sync uploads to DB
   ========================== */
async function syncUploads() {
    try {
        const files = fs_1.default.readdirSync(uploadDir).filter((f) => f.endsWith('.mp3'));
        for (const file of files) {
            const [rows] = await db.query('SELECT * FROM voiceover WHERE file_name = ?', [file]);
            if (rows.length === 0) {
                console.log(`Adding new file to DB: ${file}`);
                await db.query('INSERT INTO voiceover (voiceover_name, date_uploaded, project_date, file_name) VALUES (?, NOW(), NOW(), ?)', [path_1.default.parse(file).name, file]);
            }
        }
        console.log('✅ Uploads synced to DB');
    }
    catch (err) {
        if (err instanceof Error) {
            console.error('❌ Error syncing uploads:', err.message);
        }
        else {
            console.error('❌ Unknown error syncing uploads:', err);
        }
    }
}
/* ===================
   8. Start the server
   =================== */
app.listen(3000, async () => {
    console.log('Server running on port 3000');
    await syncUploads(); // auto-sync uploads after server starts
});
