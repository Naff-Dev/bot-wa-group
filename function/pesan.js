// function/pesan.js 
const { WA_DEFAULT_EPHEMERAL, generateWAMessageFromContent, proto } = require("@whiskeysockets/baileys");
const config = require('../config'); // Mengimpor konfigurasi
const { loadChatDatabase, saveChatDatabase } = require('../lib/db'); // Import fungsi database
const { handleGroupCommands, getOrCreateGroupData } = require('../lib/groupCommands'); // Import handler perintah grup
const { isToxic, isLink, isVirtex, isNsfw, isPromotion, isSpam } = require('../lib/guard'); // Import fungsi guard

/**
 * Fungsi utama untuk menangani setiap pesan masuk.
 * @param {object} sock Objek koneksi Baileys (socket).
 * @param {object} m Objek pesan masuk (message).
 * @param {string} currentMode Mode operasi bot (misal: 'self' atau 'public').
 */
async function handlePesan(sock, m, currentMode) {
    const jid = m.key.remoteJid; // JID (ID chat) pengirim pesan
    const isGroup = jid.endsWith('@g.us'); // Memeriksa apakah pesan berasal dari grup
    // Menentukan JID pengirim: jika dari bot sendiri, gunakan ID bot, jika grup, gunakan partisipan, jika DM, gunakan JID chat
    const sender = m.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : (isGroup ? m.key.participant : jid);
    let textMessage = ''; // Variabel untuk menyimpan teks pesan yang diekstraksi

    // === Ekstraksi Pesan ===
    // Mengambil teks dari berbagai jenis pesan WhatsApp
    if (m.message?.conversation) {
        textMessage = m.message.conversation;
    } else if (m.message?.extendedTextMessage?.text) {
        textMessage = m.message.extendedTextMessage.text;
    } else if (m.message?.imageMessage?.caption) {
        textMessage = m.message.imageMessage.caption;
    } else if (m.message?.videoMessage?.caption) {
        textMessage = m.message.videoMessage.caption;
    } else if (m.message?.documentMessage?.caption) {
        textMessage = m.message.documentMessage.caption;
    } else if (m.message?.buttonsMessage?.contentText) {
        textMessage = m.message.buttonsMessage.contentText;
    } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
        textMessage = m.message.buttonsResponseMessage.selectedDisplayText || m.message.buttonsResponseMessage.selectedButtonId;
    } else if (m.message?.listMessage?.description) {
        textMessage = m.message.listMessage.description;
    } else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
        textMessage = m.message.listResponseMessage.singleSelectReply.title || m.message.listResponseMessage.singleSelectReply.selectedRowId;
    } else if (m.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            textMessage = params.id || params.text || '';
        } catch (e) {
            console.error("Gagal mengurai paramsJson pesan interaktif:", e);
        }
    } else if (m.message?.templateButtonReplyMessage?.selectedId) {
        textMessage = m.message.templateButtonReplyMessage.selectedDisplayText || m.message.templateButtonReplyMessage.selectedId;
    } else if (m.message?.reactionMessage?.text) {
        textMessage = m.message.reactionMessage.text;
    }

    // === Pemuatan & Pembaruan Database ===
    const chatDatabase = await loadChatDatabase(); // Memuat database chat

    // Inisialisasi data pengguna jika belum ada di database
    if (!chatDatabase[sender]) {
        chatDatabase[sender] = {
            name: m.pushName || 'Anonim', // Menggunakan nama tampilan atau 'Anonim'
            lastActivity: Date.now(), // Waktu aktivitas terakhir
            count: 0 // Jumlah pesan yang dikirim
        };
    }
    // Jika pesan dari grup, pastikan pengaturan grup ada dan diinisialisasi
    if (isGroup) {
        const groupMetadata = await sock.groupMetadata(jid).catch(e => null); // Mendapatkan metadata grup
        const groupData = getOrCreateGroupData(chatDatabase, jid, groupMetadata?.subject); // Mendapatkan atau membuat data grup
        // Inisialisasi properti 'warnings' jika belum ada (berisi array timestamps peringatan)
        if (!groupData.groupSettings.warnings) {
            groupData.groupSettings.warnings = {};
        }
    }

    // Memperbarui waktu aktivitas terakhir dan jumlah pesan pengirim
    chatDatabase[sender].lastActivity = Date.now();
    chatDatabase[sender].count++;
    await saveChatDatabase(chatDatabase); // Menyimpan perubahan awal database

    // === Logika Anti-Fitur (Jika di Grup dan Diaktifkan) ===
    if (isGroup) {
        const groupData = chatDatabase[jid]; // Mendapatkan data grup yang sudah diinisialisasi
        const groupSettings = groupData.groupSettings; // Mendapatkan pengaturan grup

       
        // Mendapatkan metadata grup untuk memeriksa apakah bot adalah admin
        let groupMetadata;
        try {
            groupMetadata = await sock.groupMetadata(jid);
        } catch (error) {
            console.error('Gagal mengambil metadata grup:', error);
        }
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'; // JID bot
        // Memeriksa apakah bot adalah admin grup
        const botIsAdmin = groupMetadata?.participants.find(p => p.id === botJid)?.admin !== null;

        // Memeriksa apakah pengirim adalah admin grup
        const senderIsGroupAdmin = groupMetadata?.participants.find(p => p.id === sender)?.admin !== null;
        // Memeriksa apakah pengirim adalah owner grup (dari metadata WhatsApp)
        const senderIsGroupOwner = groupMetadata?.owner === sender;
        // Memeriksa apakah pengirim adalah owner bot yang didefinisikan di config.js
        const senderIsConfigOwner = config.OWNER_NUMBERS && config.OWNER_NUMBERS.includes(sender.replace('@s.whatsapp.net', ''));

        // Menentukan apakah pengirim adalah admin atau owner (grup atau bot)
        const senderIsAdminOrOwner = senderIsGroupAdmin || senderIsGroupOwner || senderIsConfigOwner;

        // LOG DEBUG: Menampilkan status admin/owner pengirim
        console.log(`[DEBUG - Status Pengirim] Pengirim: ${sender}`);
        console.log(`  Pengirim adalah Admin Grup: ${senderIsGroupAdmin}`);
        console.log(`  Pengirim adalah Owner Grup: ${senderIsGroupOwner}`);
        console.log(`  Pengirim adalah Owner Konfigurasi Bot: ${senderIsConfigOwner}`);
        console.log(`  Pengirim adalah Admin atau Owner (gabungan): ${senderIsAdminOrOwner}`);
        // AKHIR LOG DEBUG

        // Jangan memproses pesan dari bot sendiri atau dari admin/owner grup untuk fitur anti (pencegahan false positive)
        if (sender === botJid || senderIsAdminOrOwner) {
            console.log(`[DEBUG - Fitur Anti Dilewati] Pesan dari ${sender} (Bot atau Admin/Owner).`);
        } else {
            let violationDetected = false; // Flag untuk mendeteksi pelanggaran
            let violationType = ''; // Tipe pelanggaran yang terdeteksi
            let immediatePunishment = false; // Flag untuk hukuman instan (kick & ban)

            // --- Logika Reset Peringatan Berwaktu (30 Menit) ---
            const THIRTY_MINUTES = 30 * 60 * 1000; // 30 menit dalam milidetik

            // Pastikan array peringatan pengirim ada
            if (!groupData.groupSettings.warnings[sender]) {
                groupData.groupSettings.warnings[sender] = [];
            }
            // Memfilter peringatan yang lebih lama dari 30 menit
            groupData.groupSettings.warnings[sender] = groupData.groupSettings.warnings[sender].filter(
                timestamp => (Date.now() - timestamp) < THIRTY_MINUTES
            );
            // --- AKHIR Logika Reset Peringatan Berwaktu ---


            // Memeriksa apakah textMessage adalah COMMAND (berdasarkan perintah yang dikenal dan prefix)
            let isIncomingCommand = false;
            // Daftar semua perintah yang dikenal (harus cocok dengan yang ada di groupCommands.js)
            const allKnownCommands = [
                'groupmenu', 'welcome', 'goodbye', 'welcomepp', 'setgroupicon', 'setgroupname', 'setgroupdesc',
                'mutegroup', 'unmutegroup', 'toggleephemeral', 'setaddmode',
                'add', 'kick', 'promote', 'demote', 'leavegroup', 'getinvite',
                'revokeinvite', 'joinrequests', 'pinmsg', 'unpinmsg',
                'anti_toxic', 'anti_link', 'anti_virtex', 'anti_flood', 'anti_nsfw', 'anti_promo',
                'hidetag', 'tagall', 'totag', 'menu' // 'menu' sebagai alias untuk groupmenu
            ];
            const firstWordOfMessage = textMessage.toLowerCase().trim().split(' ')[0];

            if (config.PREFIX_ENABLED) {
                // Jika prefix diaktifkan, periksa apakah pesan dimulai dengan prefix dan diikuti oleh perintah yang dikenal
                for (const p of config.PREFIXES) {
                    if (textMessage.toLowerCase().startsWith(p.toLowerCase())) {
                        const potentialCommand = textMessage.slice(p.length).trim().split(' ')[0].toLowerCase();
                        if (allKnownCommands.includes(potentialCommand)) {
                            isIncomingCommand = true;
                            break;
                        }
                    }
                }
            } else {
                // Jika prefix dinonaktifkan, periksa apakah kata pertama pesan adalah perintah yang dikenal
                if (allKnownCommands.includes(firstWordOfMessage)) {
                    isIncomingCommand = true;
                }
            }

            // HANYA jalankan deteksi fitur anti jika ini BUKAN perintah
            if (!isIncomingCommand) { 
                // Anti-Rusuh/Spam (properti database: antirusuh)
                if (groupSettings.antirusuh && isSpam(jid, sender, m.key.id)) {
                    violationDetected = true;
                    violationType = 'anti_flood'; // Tipe pelanggaran yang akan ditampilkan
                }

                // Deteksi berdasarkan teks pesan (untuk toxic, link, virtex, nsfw, promosi)
                if (!violationDetected && textMessage) { // Hanya memeriksa jika belum ada pelanggaran lain
                    if (groupSettings.antitoxic && isToxic(textMessage)) {
                        violationDetected = true;
                        violationType = 'anti_toxic';
                    } else if (groupSettings.antilink && isLink(textMessage)) {
                        violationDetected = true;
                        violationType = 'anti_link';
                    } else if (groupSettings.antivirtex && isVirtex(textMessage)) {
                        violationDetected = true;
                        violationType = 'anti_virtex';
                        immediatePunishment = true; // Hukuman instan untuk virtex
                    } else if (groupSettings.antinsfw && isNsfw(textMessage)) {
                        violationDetected = true;
                        violationType = 'anti_nsfw';
                        immediatePunishment = true; // Hukuman instan untuk NSFW
                    } else if (groupSettings.antipromosi && isPromotion(textMessage)) { // Periksa anti-promosi (properti database: antipromosi)
                        violationDetected = true;
                        violationType = 'anti_promo'; // Tipe pelanggaran yang akan ditampilkan
                    }
                }
            }

            // Jika pelanggaran terdeteksi
            if (violationDetected) {
                let warningMessage = ''; // Pesan peringatan yang akan dikirim

                if (botIsAdmin) { // Jika bot adalah admin grup
                    await sock.sendMessage(jid, { delete: m.key }); // Hapus pesan yang melanggar

                    if (immediatePunishment) { // Jika hukuman instan (virtex/NSFW)
                        try {
                            await sock.groupParticipantsUpdate(jid, [sender], 'remove'); // Kick pengguna
                            await sock.updateBlockStatus(sender, 'block'); // Blokir pengguna
                            warningMessage = `🔥 @${sender.split('@')[0]} telah *dikeluarkan dan diblokir* dari grup karena terdeteksi *${violationType.replace('_', ' ').toUpperCase()}*!`;
                            groupData.groupSettings.warnings[sender] = []; // Hapus semua peringatan untuk hukuman instan
                        } catch (actionError) {
                            console.error(`Gagal melakukan tindakan instan (${violationType}):`, actionError);
                            warningMessage = `⚠️ Gagal melakukan tindakan instan (${violationType}) pada @${sender.split('@')[0]}. Bot mungkin tidak memiliki izin yang cukup atau pengguna tersebut adalah admin/owner.`;
                        }
                    } else { // Untuk pelanggaran yang menggunakan sistem N-peringatan (toxic, link, flood, promo)
                        groupData.groupSettings.warnings[sender].push(Date.now()); // Menambahkan timestamp peringatan baru
                        // Memfilter ulang peringatan untuk memastikan semua peringatan yang dihitung masih baru (dalam 30 menit)
                        groupData.groupSettings.warnings[sender] = groupData.groupSettings.warnings[sender].filter(
                            timestamp => (Date.now() - timestamp) < THIRTY_MINUTES
                        );
                        const currentWarnings = groupData.groupSettings.warnings[sender].length; // Mendapatkan jumlah peringatan aktif saat ini

                        // Membuat pesan peringatan berdasarkan tipe pelanggaran
                        switch (violationType) {
                            case 'anti_toxic':
                                warningMessage = `🚫 Kata-kata kasar terdeteksi dari @${sender.split('@')[0]}! (${currentWarnings}/5) Mohon jaga ucapan Anda.`;
                                break;
                            case 'anti_link':
                                warningMessage = `🔗 Tautan terdeteksi dari @${sender.split('@')[0]}! (${currentWarnings}/5) Tautan umum tidak diizinkan di grup ini.`;
                                break;
                            case 'anti_flood':
                                warningMessage = `⚠️ Spam/Flood terdeteksi dari @${sender.split('@')[0]}! (${currentWarnings}/5)`;
                                break;
                            case 'anti_promo':
                                warningMessage = `🚫 Promosi terdeteksi dari @${sender.split('@')[0]}! (${currentWarnings}/5) Promosi grup/channel lain tidak diizinkan.`;
                                break;
                        }

                        if (currentWarnings >= 5) { // Ambang batas 5 peringatan untuk kick
                            try {
                                await sock.groupParticipantsUpdate(jid, [sender], 'remove'); // Kick pengguna
                                warningMessage += `\n👋 @${sender.split('@')[0]} telah dikeluarkan dari grup karena mencapai 5 pelanggaran (${violationType.replace('_', ' ')}).`;
                                groupData.groupSettings.warnings[sender] = []; // Reset peringatan setelah kick
                            } catch (kickError) {
                                console.error('Gagal mengkick pengguna:', kickError);
                                warningMessage += `\n⚠️ Gagal mengkick @${sender.split('@')[0]}. Bot mungkin tidak memiliki izin yang cukup atau pengguna tersebut adalah admin/owner.`;
                            }
                        }
                    }
                    await sock.sendMessage(jid, { text: warningMessage, mentions: [sender] }); // Kirim pesan peringatan
                } else {
                    // Jika bot bukan admin, hanya kirim peringatan (tidak bisa menghapus/kick/ban)
                    let baseWarning = '';
                    switch (violationType) {
                        case 'anti_toxic': baseWarning = `🚫 Kata-kata kasar terdeteksi dari @${sender.split('@')[0]}!`; break;
                        case 'anti_link': baseWarning = `🔗 Tautan terdeteksi dari @${sender.split('@')[0]}!`; break;
                        case 'anti_virtex': baseWarning = `👾 Pesan berbahaya/virtex terdeteksi dari @${sender.split('@')[0]}!`; break;
                        case 'anti_nsfw': baseWarning = `🔞 Konten NSFW terdeteksi dari @${sender.split('@')[0]}!`; break;
                        case 'anti_flood': baseWarning = `⚠️ Spam/Flood terdeteksi dari @${sender.split('@')[0]}!`; break;
                        case 'anti_promo': baseWarning = `🚫 Promosi terdeteksi dari @${sender.split('@')[0]}!`; break;
                    }
                    await sock.sendMessage(jid, { text: `${baseWarning} Bot bukan admin, tidak bisa menghapus pesan atau kick/blokir.` }, { quoted: m });
                }
                await saveChatDatabase(chatDatabase); // Simpan status peringatan
                return; // Hentikan pemrosesan pesan lebih lanjut setelah pelanggaran
            }
        }
    }

    // === Logika Penanganan Prefix ===
    let actualCommand = '';
    let actualArgs = '';
    let usedPrefix = '';
    let isCommand = false;

    // Daftar semua perintah yang dikenal (harus cocok dengan yang ada di groupCommands.js)
    const allKnownCommands = [
        'groupmenu', 'welcome', 'goodbye', 'welcomepp', 'setgroupicon', 'setgroupname', 'setgroupdesc',
        'mutegroup', 'unmutegroup', 'toggleephemeral', 'setaddmode',
        'add', 'kick', 'promote', 'demote', 'leavegroup', 'getinvite',
        'revokeinvite', 'joinrequests', 'pinmsg', 'unpinmsg',
        'anti_toxic', 'anti_link', 'anti_virtex', 'anti_flood', 'anti_nsfw', 'anti_promo',
        'hidetag', 'tagall', 'totag', 'menu' // 'menu' sebagai alias untuk groupmenu
    ];

    if (config.PREFIX_ENABLED) {
        for (const p of config.PREFIXES) {
            if (textMessage.toLowerCase().startsWith(p.toLowerCase())) {
                usedPrefix = p;
                const fullCommand = textMessage.slice(p.length).trim();
                const potentialCommand = fullCommand.split(' ')[0].toLowerCase();
                
                if (allKnownCommands.includes(potentialCommand)) {
                    actualCommand = potentialCommand;
                    actualArgs = fullCommand.split(' ').slice(1).join(' ');
                    isCommand = true;
                }
                break; // Hentikan setelah menemukan prefix yang cocok
            }
        }
    } else {
        // Jika prefix dinonaktifkan, periksa apakah kata pertama pesan adalah perintah yang dikenal
        const tempCommand = textMessage.toLowerCase().trim().split(' ')[0];
        if (allKnownCommands.includes(tempCommand)) {
            actualCommand = tempCommand;
            actualArgs = textMessage.trim().split(' ').slice(1).join(' ');
            isCommand = true;
        }
    }

    // Jika perintah terdeteksi (berdasarkan prefix atau daftar perintah yang dikenal)
    if (isCommand) {
        console.log(`[Perintah Diterima] Dari: ${sender}, Perintah: "${usedPrefix}${actualCommand}", Argumen: "${actualArgs}"`);

        try {
            // Coba memproses perintah dengan handler grup terlebih dahulu jika itu adalah grup
            if (isGroup) {
                const groupHandled = await handleGroupCommands(sock, m, chatDatabase, saveChatDatabase, actualCommand, actualArgs, usedPrefix);
                if (groupHandled) {
                    return; // Jika perintah berhasil ditangani oleh handler grup, hentikan
                }
            }

            // Jika bukan perintah grup atau tidak ditangani oleh handler grup (dan itu memang perintah)
            switch (actualCommand) {
                case 'groupmenu': // Menggunakan nama perintah baru
                case 'menu': // 'menu' tetap sebagai alias
                    if (isGroup) {
                        const groupHandled = await handleGroupCommands(sock, m, chatDatabase, saveChatDatabase, 'groupmenu', actualArgs, usedPrefix); // Arahkan ke groupmenu
                        if (groupHandled) return;
                    } else {
                        await sock.sendMessage(jid, { text: `Maaf, bot ini hanya memiliki perintah khusus grup. Silakan gunakan perintah \`${usedPrefix}groupmenu\` di dalam grup.` });
                    }
                    break;
                
                default:
                    // Jika mencapai bagian ini, berarti isCommand TRUE tetapi tidak ada handler yang cocok
                    console.log(`[Perintah Tidak Dikenal] Perintah "${usedPrefix}${actualCommand}" tidak ditemukan di handler.`);
                    await sock.sendMessage(jid, { text: `Maaf, perintah \`${usedPrefix}${actualCommand}\` tidak dikenali. Bot ini hanya berfokus pada perintah grup. Ketik \`${usedPrefix}groupmenu\` di grup untuk melihat daftar perintah.` });
                    break;
            }
        } catch (error) {
            console.error('Terjadi kesalahan pada handlePesan:', error);
            await sock.sendMessage(jid, { text: 'Terjadi kesalahan saat memproses permintaan Anda.' });
        }
    } else {
        // Jika bukan perintah dan bukan pelanggaran, tidak ada yang perlu dilakukan
        // Log ini akan muncul jika pesan hanya teks biasa dan tidak terdeteksi sebagai pelanggaran
        // console.log(`[Bukan Perintah atau Pelanggaran] Mengabaikan pesan: "${textMessage}"`);
    }
}

module.exports = handlePesan;
