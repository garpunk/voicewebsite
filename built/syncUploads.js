"use strict";
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');
const uploadsDir = path.join(__dirname, 'uploads');
async function syncUploads() {
    try {
        const files = fs
            .readdirSync(uploadsDir) // returns string[]
            .filter((f) => f.endsWith('.mp3'));
        for (const file of files) {
            // Check if the file already exists in DB
            const [rows] = await db.query('SELECT * FROM voiceover WHERE file_name = ?', [file]);
            if (rows.length === 0) {
                console.log(`Adding new file to DB: ${file}`);
                await db.query('INSERT INTO voiceover (voiceover_name, date_uploaded, project_date, file_name) VALUES (?, NOW(), NOW(), ?)', [path.parse(file).name, file]);
            }
            else {
                console.log(`Already in DB: ${file}`);
            }
        }
        console.log('✅ Sync complete!');
        process.exit(0);
    }
    catch (err) {
        console.error('❌ Error syncing uploads:', err);
        process.exit(1);
    }
}
syncUploads();
