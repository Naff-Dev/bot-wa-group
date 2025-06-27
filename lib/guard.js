// function/guard.js
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Jimp = require('jimp'); // Untuk analisis gambar jika diperlukan di masa depan (saat ini hanya placeholder)

// --- Konfigurasi Deteksi ---
// Kata-kata kotor/toxic (bisa diperluas)
const toxicWords = ['anjing', 'bangsat', 'kontol', 'memek', 'asu', 'jancok', 'goblok', 'tolol', 'babi', 'peler'];

// Pola Link umum (bukan hanya undangan grup)
const linkPattern = /(https?:\/\/[^\s]+)/gi; // Deteksi semua link HTTP/HTTPS

// Pola Promosi (khususnya link undangan grup WhatsApp atau wa.me)
const promotionPattern = /(chat\.whatsapp\.com\/[a-zA-Z0-9]+|wa\.me\/\d+)/gi;


// Pola Virtex/Bug yang lebih kuat
const virtexPatterns = [
    /[\u200b\u200c\u200d\u00A0\uFEFF\u180E]/g, // Zero-width characters
    /(.)\1{20,}/,         // Any character repeated 20+ times
    /(\s.{1,2}){15,}/,    // Repeated short sequences with spaces
    /.{3000,}/,           // Very long single string without spaces (potential lag/crash)
    /(\n\s*){25,}/,       // Excessive newlines (25+ empty lines)
    /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, // Common control characters
    /[\u0008\u000B\u000C\u000E-\u001F]/g, // Specific Unicode control characters
    /[\uFB50-\uFDFF\uFE70-\uFEFF\uFF00-\uFFEF]/g, // Arabic Presentation Forms, Halfwidth and Fullwidth Forms
    /(\s{2,}|\t|\v|\r|\f)+/, // Multiple spaces, tabs, vertical tabs, form feeds
    /[\u200E\u200F\u202A-\u202E\u2060-\u206F]/g, // Bidirectional text control characters, invisible operators
    /[\u0300-\u036F\u0483-\u0487\u0591-\u05BD\u05BF-\u05C2\u05C4-\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06ED\u0E31\u0E34-\u0E3A\u0EB1\u0EB4-\u0EB9\u0EC8-\u0ECD\u17DD\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\uA670-\uA672\uA674-\uA67D\uA69F\uA717-\uA71F\uA836-\uA839\uA871-\uA873\uA877-\uA878\uA89E-\uA89F\uA8B4-\uA8C3\uA8D1-\uA8D3\uA926-\uA92D\uA947-\uA951\uA980-\uA982\uAA29-\uAA2E\uAA43\uAA4C\uAA7C\uAAE0-\uAAE3\uAAF2-\uAAF3\uAB30-\uAB31\uAB70-\uAB71\uABDE-\uABDF\uABC5-\uABC9\uABCE-\uABCF\uABDA\uFBC0-\uFBCF\uFE00-\uFE0F]/g // Various combining diacritics and symbols
];


// Kata kunci NSFW (bisa diperluas untuk lebih komprehensif)
const nsfwKeywords = ['seks', 'bugil', 'porno', 'telanjang', 'xxx', 'bokep', 'bocil', 'cabul', 'hentai', 'lonte', 'sange'];

// Cache pesan untuk fitur anti-rusuh (spam/flood)
const messageCache = {}; // { jid: { sender: [{ timestamp: number, messageId: string }], lastCleanUp: number } }
const SPAM_THRESHOLD_COUNT = 5; // Jumlah pesan maksimum dalam periode waktu
const SPAM_THRESHOLD_TIME = 10000; // Periode waktu (10 detik)
const CACHE_CLEANUP_INTERVAL = 60000; // Bersihkan cache setiap 1 menit

/**
 * Memeriksa apakah pesan mengandung kata-kata toxic.
 * @param {string} text Pesan teks.
 * @returns {boolean} True jika toxic, false jika tidak.
 */
function isToxic(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return toxicWords.some(word => lowerText.includes(word));
}

/**
 * Memeriksa apakah pesan mengandung link umum (bukan hanya promosi grup).
 * @param {string} text Pesan teks.
 * @returns {boolean} True jika mengandung link, false jika tidak.
 */
function isLink(text) {
    if (!text) return false;
    return linkPattern.test(text);
}

/**
 * Memeriksa apakah pesan adalah potensi virtex/bug.
 * @param {string} text Pesan teks.
 * @returns {boolean} True jika virtex, false jika tidak.
 */
function isVirtex(text) {
    if (!text) return false;
    if (text.length > 5000) return true; // Ambang batas panjang yang bisa disesuaikan
    return virtexPatterns.some(pattern => pattern.test(text));
}

/**
 * Memeriksa apakah pesan mengandung kata kunci NSFW.
 * @param {string} text Pesan teks.
 * @returns {boolean} True jika NSFW, false jika tidak.
 */
function isNsfw(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return nsfwKeywords.some(keyword => lowerText.includes(keyword));
}

/**
 * Memeriksa apakah pesan mengandung pola promosi (link undangan grup WA atau wa.me).
 * @param {string} text Pesan teks.
 * @returns {boolean} True jika promosi, false jika tidak.
 */
function isPromotion(text) {
    if (!text) return false;
    return promotionPattern.test(text);
}

/**
 * Memeriksa apakah pengirim melakukan spam/flood.
 * @param {string} jid JID grup.
 * @param {string} sender JID pengirim pesan.
 * @param {string} messageId ID pesan.
 * @returns {boolean} True jika spam, false jika tidak.
 */
function isSpam(jid, sender, messageId) {
    const now = Date.now();

    if (!messageCache[jid]) {
        messageCache[jid] = {};
    }
    if (!messageCache[jid][sender]) {
        messageCache[jid][sender] = [];
    }

    // Hapus pesan lama dari cache
    messageCache[jid][sender] = messageCache[jid][sender].filter(
        msg => (now - msg.timestamp) < SPAM_THRESHOLD_TIME
    );

    // Tambahkan pesan saat ini ke cache
    messageCache[jid][sender].push({ timestamp: now, messageId: messageId });

    // Bersihkan cache grup secara berkala
    if (!messageCache[jid].lastCleanUp || (now - messageCache[jid].lastCleanUp) > CACHE_CLEANUP_INTERVAL) {
        for (const user in messageCache[jid]) {
            if (user !== 'lastCleanUp') {
                messageCache[jid][user] = messageCache[jid][user].filter(
                    msg => (now - msg.timestamp) < SPAM_THRESHOLD_TIME * 2 // Cache lebih lama untuk membersihkan
                );
                if (messageCache[jid][user].length === 0) {
                    delete messageCache[jid][user]; // Hapus user jika tidak ada pesan baru
                }
            }
        }
        messageCache[jid].lastCleanUp = now;
    }

    // Cek apakah melebihi batas pesan
    return messageCache[jid][sender].length > SPAM_THRESHOLD_COUNT;
}


module.exports = {
    isToxic,
    isLink,
    isVirtex,
    isNsfw,
    isPromotion, // Ekspor fungsi baru
    isSpam
};
