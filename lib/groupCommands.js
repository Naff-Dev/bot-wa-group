// function/groupCommands.js
const { WA_DEFAULT_EPHEMERAL, generateWAMessageFromContent, proto } = require("@whiskeysockets/baileys");
const config = require('../config'); // Import configuration
const { downloadMediaMessage } = require('@whiskeysockets/baileys'); // For asynchronous file operations
const Jimp = require('jimp'); // For image manipulation, like resizing profile pictures

// Function to get or initialize group object in the database
function getOrCreateGroupData(chatDatabase, jid, subject = 'Unknown Group') {
    if (!chatDatabase[jid]) {
        chatDatabase[jid] = {
            name: subject,
            lastActivity: Date.now(),
            count: 0,
            groupSettings: {
                welcomeMessage: null,
                goodbyeMessage: null,
                welcomeWithPp: false,
                antitoxic: false,
                antilink: false,
                antivirtex: false,
                antirusuh: false, // Anti-spam/flood
                antinsfw: false,
                antipromosi: false, // Add anti-promotion feature
                isMuted: false, // Group mute status
                warnings: {} // Initialize object to store warnings
            }
        };
    } else if (!chatDatabase[jid].groupSettings) {
        // If group data exists but without groupSettings (e.g., from an old update)
        chatDatabase[jid].groupSettings = {
            welcomeMessage: null,
            goodbyeMessage: null,
            welcomeWithPp: false,
            antitoxic: false,
            antilink: false,
            antivirtex: false,
            antirusuh: false,
            antinsfw: false,
            antipromosi: false, // Add anti-promotion feature
            isMuted: false,
            warnings: {}
        };
    } else if (!chatDatabase[jid].groupSettings.warnings) {
        // If groupSettings exist but warnings do not
        chatDatabase[jid].groupSettings.warnings = {};
    } else {
        // Ensure all anti-features exist in groupSettings upon initialization/access
        const defaultAntiFeatures = {
            antitoxic: false,
            antilink: false,
            antivirtex: false,
            antirusuh: false,
            antinsfw: false,
            antipromosi: false,
        };
        for (const key in defaultAntiFeatures) {
            if (chatDatabase[jid].groupSettings[key] === undefined) {
                chatDatabase[jid].groupSettings[key] = defaultAntiFeatures[key];
            }
        }
    }
    return chatDatabase[jid];
}

async function handleGroupCommands(sock, m, chatDatabase, saveChatDatabase, actualCommand, actualArgs, usedPrefix) {
    const jid = m.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const sender = m.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : (isGroup ? m.key.participant : jid);

    if (!isGroup) {
        await sock.sendMessage(jid, { text: 'This command is only for groups.' });
        return false; // Indicates that the command was not processed here
    }

    // Get group metadata to check bot admin status
    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(jid);
    } catch (error) {
        console.error('Failed to retrieve group metadata:', error);
        await sock.sendMessage(jid, { text: 'Failed to retrieve group information. Make sure the bot is in this group.' });
        return false;
    }

    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botIsAdmin = groupMetadata.participants.find(p => p.id === botJid)?.admin !== null;

    // Check if sender is a group admin
    const senderIsGroupAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin !== null;
    // Check if sender is the group owner (from WhatsApp metadata)
    const senderIsGroupOwner = groupMetadata.owner === sender;
    // Check if sender is a bot owner defined in config.js
    const senderIsConfigOwner = config.OWNER_NUMBERS && config.OWNER_NUMBERS.includes(sender.replace('@s.whatsapp.net', ''));

    const senderIsAdminOrOwner = senderIsGroupAdmin || senderIsGroupOwner || senderIsConfigOwner;

    // Initialize group data if not already present or incomplete
    const groupData = getOrCreateGroupData(chatDatabase, jid, groupMetadata.subject);
    await saveChatDatabase(chatDatabase); // Save current status

    // List of commands that require the bot to be a group admin
    const requiresBotAdmin = [
        'welcome', 'goodbye', 'welcomepp', 'setgroupicon', 'setgroupname', 'setgroupdesc',
        'mutegroup', 'unmutegroup', 'toggleephemeral', 'setaddmode',
        'add', 'kick', 'promote', 'demote', 'leavegroup',
        'getinvite', 'revokeinvite', 'joinrequests', 'pinmsg', 'unpinmsg',
        'anti_toxic', 'anti_link', 'anti_virtex', 'anti_flood', 'anti_nsfw', 'anti_promo',
        'hidetag', 'tagall', 'totag'
    ];

    // List of commands that require the sender to be a group admin or owner
    const requiresSenderAdminOrOwner = [
        'welcome', 'goodbye', 'welcomepp', 'setgroupicon', 'setgroupname', 'setgroupdesc',
        'mutegroup', 'unmutegroup', 'toggleephemeral', 'setaddmode',
        'add', 'kick', 'promote', 'demote', 'leavegroup',
        'getinvite', 'revokeinvite', 'joinrequests', 'pinmsg', 'unpinmsg',
        'anti_toxic', 'anti_link', 'anti_virtex', 'anti_flood', 'anti_nsfw', 'anti_promo',
        'hidetag', 'tagall', 'totag'
    ];

    if (requiresBotAdmin.includes(actualCommand) && !botIsAdmin) {
        await sock.sendMessage(jid, { text: `Bot must be a group admin to use the \`${usedPrefix}${actualCommand}\` command.` });
        return true;
    }

    if (requiresSenderAdminOrOwner.includes(actualCommand) && !senderIsAdminOrOwner) {
        await sock.sendMessage(jid, { text: `You must be a group admin or owner (including bot owner) to use the \`${usedPrefix}${actualCommand}\` command.` });
        return true;
    }


    switch (actualCommand) {
        case 'groupmenu':
            const groupSettings = groupData.groupSettings;
            const groupMenuText = `
╔═════════════════╗
║ 👥 GROUP COMMANDS ║
╚═════════════════╝
Group Name: ${groupMetadata.subject}

╭───[ ⚙️ GROUP SETTINGS ]───────
│ ${usedPrefix}welcome <message>
│ ${usedPrefix}goodbye <message>
│ ${usedPrefix}welcomepp <message>
│ ${usedPrefix}setgroupicon (reply to image)
│ ${usedPrefix}setgroupname <name>
│ ${usedPrefix}setgroupdesc <description>
│ ${usedPrefix}mutegroup
│ ${usedPrefix}unmutegroup
│ ${usedPrefix}toggleephemeral
│ ${usedPrefix}setaddmode <all_members|admins_only>
│ ${usedPrefix}add <number|reply>
│ ${usedPrefix}kick <number|reply>
│ ${usedPrefix}promote <number>
│ ${usedPrefix}demote <number>
│ ${usedPrefix}leavegroup
│ ${usedPrefix}getinvite
│ ${usedPrefix}revokeinvite
│ ${usedPrefix}joinrequests
│ ${usedPrefix}pinmsg
│ ${usedPrefix}unpinmsg
╰───────────────────

╭───[ 🛡️ GROUP PROTECTION ]───────
│ ${usedPrefix}anti_toxic <on|off> (Current: ${groupSettings.antitoxic ? 'ON' : 'OFF'})
│ ${usedPrefix}anti_link <on|off> (Current: ${groupSettings.antilink ? 'ON' : 'OFF'})
│ ${usedPrefix}anti_virtex <on|off> (Current: ${groupSettings.antivirtex ? 'ON' : 'OFF'})
│ ${usedPrefix}anti_flood <on|off> (Current: ${groupSettings.antirusuh ? 'ON' : 'OFF'})
│ ${usedPrefix}anti_nsfw <on|off> (Current: ${groupSettings.antinsfw ? 'ON' : 'OFF'})
│ ${usedPrefix}anti_promo <on|off> (Current: ${groupSettings.antipromosi ? 'ON' : 'OFF'})
╰───────────────────

╭───[ 💬 TAGGING ]───────
│ ${usedPrefix}hidetag <message>
│ ${usedPrefix}tagall <optional_message>
│ ${usedPrefix}totag <optional_message> (reply to message)
╰───────────────────
            `.trim();
            await sock.sendMessage(jid, { text: groupMenuText });
            break;

        case 'welcome': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}welcome <welcome message>\`\n\nAvailable variables:\n{name} - User's name\n{group} - Group's name` });
                break;
            }
            groupData.groupSettings.welcomeMessage = actualArgs;
            groupData.groupSettings.welcomeWithPp = false;
            await saveChatDatabase(chatDatabase);
            await sock.sendMessage(jid, { text: `Welcome message set successfully.` });
            break;

        case 'goodbye': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}goodbye <goodbye message>\`\n\nAvailable variables:\n{name} - User's name\n{group} - Group's name` });
                break;
            }
            groupData.groupSettings.goodbyeMessage = actualArgs;
            await saveChatDatabase(chatDatabase);
            await sock.sendMessage(jid, { text: `Goodbye message set successfully.` });
            break;

        case 'setgroupicon': // New command
            if (!m.message?.imageMessage) {
                await sock.sendMessage(jid, { text: `Reply to an image with the caption \`${usedPrefix}setgroupicon\` to set the group profile picture.` });
                break;
            }
            try {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                const image = await Jimp.read(buffer);
                const resizedBuffer = await image.resize(640, 640).getBufferAsync(Jimp.MIME_JPEG);
                
                await sock.groupUpdatePhoto(jid, resizedBuffer);
                await sock.sendMessage(jid, { text: 'Group profile picture changed successfully.' });
            } catch (error) {
                console.error('Error changing group PP:', error);
                await sock.sendMessage(jid, { text: 'Failed to change group profile picture. Make sure this is a valid image.' });
            }
            break;

        case 'welcomepp': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}welcomepp <welcome message>\`\n\nBot will automatically include the new user's profile picture.\nAvailable variables:\n{name} - User's name\n{group} - Group's name` });
                break;
            }
            groupData.groupSettings.welcomeMessage = actualArgs;
            groupData.groupSettings.welcomeWithPp = true;
            await saveChatDatabase(chatDatabase);
            await sock.sendMessage(jid, { text: `Welcome message with user profile picture set successfully.` });
            break;

        case 'anti_toxic':
        case 'anti_link':
        case 'anti_virtex':
        case 'anti_flood': // Changed from antirusuh
        case 'anti_nsfw':
        case 'anti_promo': // Changed from antipromosi
            if (!actualArgs || !['on', 'off'].includes(actualArgs.toLowerCase())) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}${actualCommand} <on|off>\`` });
                break;
            }
            const featureName = actualCommand;
            // Map anti_flood to antirusuh in groupSettings
            const dbFeatureName = actualCommand === 'anti_flood' ? 'antirusuh' : (actualCommand === 'anti_promo' ? 'antipromosi' : actualCommand);

            groupData.groupSettings[dbFeatureName] = (actualArgs.toLowerCase() === 'on');
            await saveChatDatabase(chatDatabase);
            await sock.sendMessage(jid, { text: `*${actualCommand.replace('_', ' ').toUpperCase()}* feature in this group has been turned: *${actualArgs.toUpperCase()}*.` });
            break;

        case 'mutegroup':
            try {
                await sock.groupSettingUpdate(jid, 'locked');
                groupData.groupSettings.isMuted = true;
                await saveChatDatabase(chatDatabase);
                await sock.sendMessage(jid, { text: 'This group has been muted (only admins can send messages).' });
            } catch (error) {
                console.error('Error muting group:', error);
                await sock.sendMessage(jid, { text: 'Failed to mute group.' });
            }
            break;

        case 'unmutegroup':
            try {
                await sock.groupSettingUpdate(jid, 'unlocked');
                groupData.groupSettings.isMuted = false;
                await saveChatDatabase(chatDatabase);
                await sock.sendMessage(jid, { text: 'This group has been unmuted (all members can send messages).' });
            } catch (error) {
                console.error('Error unmuting group:', error);
                await sock.sendMessage(jid, { text: 'Failed to unmute group.' });
            }
            break;

        case 'setgroupname': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}setgroupname <new name>\`` });
                break;
            }
            try {
                await sock.groupUpdateSubject(jid, actualArgs);
                await sock.sendMessage(jid, { text: `Group name changed to: "${actualArgs}".` });
            } catch (error) {
                console.error('Error changing group name:', error);
                await sock.sendMessage(jid, { text: 'Failed to change group name.' });
            }
            break;

        case 'setgroupdesc': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}setgroupdesc <new description>\`` });
                break;
            }
            try {
                await sock.groupUpdateDescription(jid, actualArgs);
                await sock.sendMessage(jid, { text: `Group description changed to: "${actualArgs}".` });
            } catch (error) {
                console.error('Error changing group description:', error);
                await sock.sendMessage(jid, { text: 'Failed to change group description.' });
            }
            break;
            
        case 'toggleephemeral': // New command
            try {
                const currentEphemeralDuration = groupMetadata.ephemeralDuration;
                const newEphemeralDuration = currentEphemeralDuration === 0 ? WA_DEFAULT_EPHEMERAL : 0; // Toggle
                await sock.groupToggleEphemeral(jid, newEphemeralDuration);
                await sock.sendMessage(jid, { text: `Disappearing messages in this group have been turned ${newEphemeralDuration === 0 ? 'OFF' : 'ON'} (default duration: 7 days).` });
            } catch (error) {
                console.error('Error toggling group ephemeral:', error);
                await sock.sendMessage(jid, { text: 'Failed to toggle disappearing messages in the group.' });
            }
            break;

        case 'setaddmode': // New command
            const addMode = actualArgs.toLowerCase();
            let baileysAddMode;
            if (addMode === 'all_members') baileysAddMode = 'all_member_add';
            else if (addMode === 'admins_only') baileysAddMode = 'admin_add';
            else {
                await sock.sendMessage(jid, { text: `Invalid add mode. Use: \`${usedPrefix}setaddmode <all_members|admins_only>\`` });
                break;
            }
            try {
                await sock.groupMemberAddMode(jid, baileysAddMode);
                await sock.sendMessage(jid, { text: `Group member add mode changed to: "${addMode}".` });
            } catch (error) {
                console.error('Error changing group add mode:', error);
                await sock.sendMessage(jid, { text: 'Failed to change group member add mode.' });
            }
            break;
        
        case 'add': // Modified command
            // Try to get participant JID from replied message
            let participantJidToAdd = m.message?.extendedTextMessage?.contextInfo?.participant;
            let targetNameAdd = '';

            if (participantJidToAdd) {
                // If replied message exists, try to get sender's name from replied message's pushName or contact name
                targetNameAdd = m.message.extendedTextMessage.contextInfo.participant.split('@')[0]; // Simple extraction
            } else if (actualArgs) {
                participantJidToAdd = actualArgs.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                targetNameAdd = actualArgs;
            } else {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}add <number|reply to message>\` (example: ${usedPrefix}add 6281234567890 or reply to user)` });
                break;
            }

            try {
                await sock.groupParticipantsUpdate(jid, [participantJidToAdd], 'add');
                await sock.sendMessage(jid, { text: `Successfully added ${targetNameAdd}.` });
            } catch (error) {
                console.error(`Error adding participant:`, error);
                await sock.sendMessage(jid, { text: `Failed to add ${targetNameAdd}. Make sure the number is valid and they are not already in the group.` });
            }
            break;

        case 'kick': // Modified command
            // Try to get participant JID from replied message
            let participantJidToRemove = m.message?.extendedTextMessage?.contextInfo?.participant;
            let targetNameRemove = '';

            if (participantJidToRemove) {
                // If replied message exists, try to get sender's name from replied message's pushName or contact name
                targetNameRemove = m.message.extendedTextMessage.contextInfo.participant.split('@')[0]; // Simple extraction
            } else if (actualArgs) {
                participantJidToRemove = actualArgs.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                targetNameRemove = actualArgs;
            } else {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}kick <number|reply to message>\` (example: ${usedPrefix}kick 6281234567890 or reply to user)` });
                break;
            }
            
            try {
                await sock.groupParticipantsUpdate(jid, [participantJidToRemove], 'remove');
                await sock.sendMessage(jid, { text: `Successfully removed ${targetNameRemove}.` });
            } catch (error) {
                console.error(`Error removing participant:`, error);
                await sock.sendMessage(jid, { text: `Failed to remove ${targetNameRemove}. Make sure the number is valid and they are in the group.` });
            }
            break;

        case 'promote': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}promote <participant number>\` (example: ${usedPrefix}promote 6281234567890)` });
                break;
            }
            const participantJidToPromote = actualArgs.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            try {
                await sock.groupParticipantsUpdate(jid, [participantJidToPromote], 'promote');
                await sock.sendMessage(jid, { text: `Successfully promoted ${actualArgs}.` });
            } catch (error) {
                console.error(`Error promoting participant:`, error);
                await sock.sendMessage(jid, { text: `Failed to promote participant. Make sure the number is valid.` });
            }
            break;

        case 'demote': // New command
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}demote <participant number>\` (example: ${usedPrefix}demote 6281234567890)` });
                break;
            }
            const participantJidToDemote = actualArgs.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            try {
                await sock.groupParticipantsUpdate(jid, [participantJidToDemote], 'demote');
                await sock.sendMessage(jid, { text: `Successfully demoted ${actualArgs}.` });
            } catch (error) {
                console.error(`Error demoting participant:`, error);
                await sock.sendMessage(jid, { text: `Failed to demote participant. Make sure the number is valid.` });
            }
            break;

        case 'leavegroup':
            try {
                await sock.groupLeave(jid);
                console.log(`Bot successfully left group: ${jid}`);
            } catch (error) {
                console.error('Error leaving group:', error);
            }
            break;

        case 'getinvite': // New command
            try {
                const code = await sock.groupInviteCode(jid);
                await sock.sendMessage(jid, { text: `Group invite code: https://chat.whatsapp.com/${code}` });
            } catch (error) {
                console.error('Error getting invite code:', error);
                await sock.sendMessage(jid, { text: 'Failed to get invite code.' });
            }
            break;

        case 'revokeinvite': // New command
            try {
                const newCode = await sock.groupRevokeInvite(jid);
                await sock.sendMessage(jid, { text: `New invite code: https://chat.whatsapp.com/${newCode}` });
            } catch (error) {
                console.error('Error revoking invite code:', error);
                await sock.sendMessage(jid, { text: 'Failed to revoke invite code.' });
            }
            break;

        case 'joinrequests': // New command
            try {
                const requests = await sock.groupRequestParticipantsList(jid);
                if (requests.length > 0) {
                    let requestList = '*Group Join Requests:*\n\n';
                    requests.forEach(req => {
                        requestList += `- ${req.jid.split('@')[0]} (${req.displayName || 'Anonymous'})\n`;
                    });
                    await sock.sendMessage(jid, { text: requestList });
                } else {
                    await sock.sendMessage(jid, { text: 'No pending join requests.' });
                }
            } catch (error) {
                console.error('Error fetching join requests:', error);
                await sock.sendMessage(jid, { text: 'Failed to get join requests.' });
            }
            break;

        case 'pinmsg': // New command
        case 'unpinmsg': // New command
            if (!m.key) {
                await sock.sendMessage(jid, { text: 'No message to pin/unpin.' });
                break;
            }
            try {
                const type = (actualCommand === 'pinmsg') ? 1 : 0;
                await sock.sendMessage(jid, {
                    pin: {
                        type: type,
                        time: type === 1 ? 86400 : 0,
                        key: m.key
                    }
                });
                await sock.sendMessage(jid, { text: `Message ${actualCommand === 'pinmsg' ? 'pinned' : 'unpinned'} successfully.` });
            } catch (error) {
                console.error('Error pinning/unpinning message:', error);
                await sock.sendMessage(jid, { text: 'Failed to pin/unpin message.' });
            }
            break;

        case 'hidetag':
            if (!actualArgs) {
                await sock.sendMessage(jid, { text: `Usage: \`${usedPrefix}hidetag <message>\` to send a hidden message mentioning all members.` });
                break;
            }
            const hidetagParticipants = groupMetadata.participants.map(p => p.id);
            await sock.sendMessage(jid, { text: actualArgs, mentions: hidetagParticipants });
            break;

        case 'tagall':
            const tagallText = actualArgs || 'All group members!';
            const tagallParticipants = groupMetadata.participants.map(p => p.id);
            await sock.sendMessage(jid, { text: tagallText, mentions: tagallParticipants });
            break;

        case 'totag':
            const quotedMessage = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMessage) {
                await sock.sendMessage(jid, { text: `Reply to the message you want to tag with \`${usedPrefix}totag <optional_message>\` to mention all members in the replied message.` });
                break;
            }
            const totagText = actualArgs || '';
            const totagParticipants = groupMetadata.participants.map(p => p.id);
            
            await sock.sendMessage(jid, {
                text: totagText,
                mentions: totagParticipants,
                quoted: m
            });
            break;

        default:
            return false;
    }
    return true;
}

module.exports = {
    handleGroupCommands,
    getOrCreateGroupData
};
