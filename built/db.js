"use strict";
// db.js
require('dotenv').config();
const mysql = require('mysql2');
// Create a connection pool for better performance
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});
// Export for use in other files
module.exports = pool.promise();
