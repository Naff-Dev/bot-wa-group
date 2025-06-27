// db.js
const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.resolve(__dirname, '../database/db.json');

/**
 * Memuat database dari file JSON.
 * @returns {Promise<Object>} Objek database.
 */
async function loadChatDatabase() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('File database belum ada, membuat yang baru.');
            // Jika file tidak ada, buat struktur dasar dan simpan
            const defaultDb = {};
            await saveChatDatabase(defaultDb);
            return defaultDb;
        }
        console.error('Gagal memuat database:', error);
        return {}; // Kembalikan objek kosong jika ada error lain
    }
}

/**
 * Menyimpan database ke file JSON.
 * @param {Object} db Objek database yang akan disimpan.
 * @returns {Promise<void>}
 */
async function saveChatDatabase(db) {
    try {
        // Pastikan direktori database ada
        const dbDir = path.dirname(DB_FILE);
        await fs.mkdir(dbDir, { recursive: true });
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (error) {
        console.error('Gagal menyimpan database:', error);
    }
}

module.exports = {
    loadChatDatabase,
    saveChatDatabase
};
