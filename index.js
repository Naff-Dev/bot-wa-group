// index.js
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    downloadMediaMessage
} = require("@whiskeysockets/baileys")
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline')

// Import fungsi dari file Anda yang sudah ada
const handlePesan = require('./function/pesan'); // handlePesan.js
const config = require('./config'); // config.js
const { loadChatDatabase, saveChatDatabase } = require('./lib/db'); // db.js (untuk load/save database utama)
const { getOrCreateGroupData } = require('./lib/groupCommands'); // groupCommands.js (untuk inisialisasi data grup baru)

// Untuk mengunduh gambar PP user di welcome message
const Jimp = require('jimp'); // Perlu diinstal: npm install jimp
// Pastikan juga 'node-fetch' terinstal jika Node.js Anda versi lama dan tidak memiliki fetch global: npm install node-fetch

const usePairingCode = true;
const BOT_PP_PATH = path.resolve(__dirname, 'bot.png'); // Path ke gambar bot.png

// Fungsi prompt untuk pairing code
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise(resolve => rl.question(question, ans => {
        rl.close()
        resolve(ans.trim())
    }))
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`)
    const sock = makeWASocket({
        printQRInTerminal: !usePairingCode,
        syncFullHistory: true,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            return message;
        },
        version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        logger: pino({
            level: 'fatal' // Ubah ke 'info' atau 'debug' jika ingin melihat log lebih banyak
        }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino().child({
                level: 'silent',
                stream: 'store'
            })),
        }
    });

    if (usePairingCode && !sock.authState.creds.registered) {
        const phoneNumber = await prompt('please enter your WhatsApp number, starting with 62:\n');
        const code = await sock.requestPairingCode(phoneNumber, 'NAFFDEVV');
        console.log(`your pairing code: ${code}`);
    }
    
    const store = makeInMemoryStore({
        logger: pino().child({ 
            level: 'silent',
            stream: 'store' 
        }) 
    });
    
    store.bind(sock.ev);

    // Event listener untuk update koneksi
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) connectToWhatsApp()
        } else if (connection === "open") {
            console.clear();
            console.log(`
        ╔═════════════════════════════════════════════╗
        ║          🤖 BOT WHATSAPP TERHUBUNG          ║
        ╚═════════════════════════════════════════════╝
        
        📶 Status     : Tersambung ke WhatsApp Web
        🔧 Mode       : ${config.MODE.toUpperCase()}
        📁 Session    : ./session
        
        ───────────────────────────────────────────────
        🔰 Bot by     : NaffDev
        📌 Info       : No Enc - Hubungi Naff Dev
        FB            : Naff Maulana
        ───────────────────────────────────────────────
            `);
        }
    })

    sock.ev.on("creds.update", saveCreds)

    // Event listener untuk update metadata grup
    sock.ev.on('groups.update', async ([event]) => {
        if (event.id) {
            const chatDatabase = await loadChatDatabase(); // Muat database
            const groupData = getOrCreateGroupData(chatDatabase, event.id); // Dapatkan data grup

            let updatedInfo = [];
            // Cek perubahan subjek/nama grup
            if (event.subject && groupData.name !== event.subject) {
                updatedInfo.push(`Group name changed from "${groupData.name}" to "${event.subject}"`);
                groupData.name = event.subject; // Perbarui di database
            }

            if (updatedInfo.length > 0) {
                const message = `✨ Detected changes in group *${groupData.name}*:\n- ${updatedInfo.join('\n- ')}`;
                await sock.sendMessage(event.id, { text: message });
                await saveChatDatabase(chatDatabase); // Simpan perubahan ke database
            } else {
                console.log(`Group metadata updated for ${event.id}, but no specific message sent.`);
            }
        }
    });

    // Event listener untuk penambahan/penghapusan partisipan grup (Welcome/Goodbye)
    sock.ev.on('group-participants.update', async (event) => {
        const jid = event.id; // JID grup
        const chatDatabase = await loadChatDatabase(); // Muat database
        const groupData = getOrCreateGroupData(chatDatabase, jid); // Dapatkan data grup

        // Perbarui nama grup di database jika ada perubahan subjek di event
        if (event.subject && groupData.name !== event.subject) {
            groupData.name = event.subject;
        }

        for (const participant of event.participants) {
            // Pastikan participant bukan bot itu sendiri
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            if (participant === botJid) continue;

            if (event.action === 'add' && groupData.groupSettings.welcomeMessage) {
                let welcomeMsg = groupData.groupSettings.welcomeMessage
                    .replace(/{name}/g, `@${participant.split('@')[0]}`)
                    .replace(/{group}/g, groupData.name);

                let messageOptions = { text: welcomeMsg, mentions: [participant] };

                if (groupData.groupSettings.welcomeWithPp) {
                    let ppBuffer;
                    try {
                        const ppUrl = await sock.profilePictureUrl(participant, 'image');
                        if (ppUrl) {
                            const response = await fetch(ppUrl);
                            // FIX: Use .arrayBuffer() and then Buffer.from()
                            const arrayBuffer = await response.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer); 
                            
                            console.log('[DEBUG-Jimp] Attempting Jimp.read for user PP...');
                            // Ensure Jimp is correctly loaded before calling .read()
                            if (typeof Jimp.read === 'function') {
                                const image = await Jimp.read(buffer);
                                ppBuffer = await image.resize(256, 256).getBufferAsync(Jimp.MIME_JPEG);
                                console.log('[DEBUG-Jimp] User PP processed successfully.');
                            } else {
                                console.error('[DEBUG-Jimp] Jimp.read is not a function. Check Jimp installation.');
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to fetch or process user PP ${participant}:`, e);
                        // If failed to get user PP, try to use bot PP
                        try {
                            console.log('[DEBUG-Jimp] Attempting to load bot.png...');
                            const botPpRawBuffer = await fs.readFile(BOT_PP_PATH); // Read bot.png file
                            console.log('[DEBUG-Jimp] bot.png loaded. Attempting Jimp.read...');
                            if (typeof Jimp.read === 'function') {
                                const image = await Jimp.read(botPpRawBuffer);
                                ppBuffer = await image.resize(256, 256).getBufferAsync(Jimp.MIME_JPEG);
                                console.log('[DEBUG-Jimp] bot.png processed successfully.');
                            } else {
                                console.error('[DEBUG-Jimp] Jimp.read is not a function when processing bot.png. Check Jimp installation.');
                            }
                        } catch (botPpError) {
                            console.error('Failed to load or process bot.png:', botPpError);
                            ppBuffer = null; // If bot.png also fails, don't send image
                        }
                    }

                    if (ppBuffer) {
                        messageOptions = {
                            image: ppBuffer,
                            caption: welcomeMsg,
                            mentions: [participant]
                        };
                    } else {
                        // If no PP (neither user nor bot), send text message only
                        messageOptions = {
                            text: welcomeMsg,
                            mentions: [participant]
                        };
                    }
                }
                await sock.sendMessage(jid, messageOptions);
            } else if (event.action === 'remove' && groupData.groupSettings.goodbyeMessage) {
                let goodbyeMsg = groupData.groupSettings.goodbyeMessage
                    .replace(/{name}/g, `@${participant.split('@')[0]}`)
                    .replace(/{group}/g, groupData.name);
                await sock.sendMessage(jid, { text: goodbyeMsg, mentions: [participant] });
            }
        }
        await saveChatDatabase(chatDatabase); // Save database changes after event processed
    });

    // Event listener for incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const m of messages) {
                // Ignore messages from self
                // if (m.key.fromMe) continue;
                // Ignore if no message content
                if (!m.message) continue;

                const jid = m.key.remoteJid;
                const isGroup = jid.endsWith('@g.us');

                // Self/public mode logic
                if (config.MODE === 'self' && isGroup) {
                    console.log(`[SELF MODE] Ignoring message from group: ${jid}`);
                    continue;
                }

                console.log(`Message received from ${jid}:`);

                // Call handlePesan function from function/pesan.js
                // handlePesan manages database internally
                await handlePesan(sock, m, config.MODE);
            }
        }
    });

    // Event listener for message updates (e.g., for poll votes)
    sock.ev.on('messages.update', async (events) => {
        for (const { key, update } of events) {
            if (update.pollUpdates) {
                console.log('Received poll update:', update.pollUpdates);
            }
        }
    });
}

// Run main function
connectToWhatsApp();
