const { Events } = require('discord.js');
const { setupDatabase } = require('../database');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        client.db = await setupDatabase();
        const { initDB } = require('../utils/helpers');
        await initDB(client.db);
        
        require('../scheduler').initScheduler(client);
        console.log(`[ATLAS] v1.3.0 Systems Online.`);

        const path = require('path');
        const fs = require('fs');
        const avatarGif = path.join(__dirname, '../../assets/avatar.gif');
        const avatarPng = path.join(__dirname, '../../assets/avatar.png');
        
        try { 
            if (fs.existsSync(avatarGif)) {
                await client.user.setAvatar(avatarGif); 
                console.log('[ATLAS] Avatar updated from local GIF.'); 
            } else if (fs.existsSync(avatarPng)) {
                await client.user.setAvatar(avatarPng);
                console.log('[ATLAS] Avatar updated from local PNG fallback.');
            } else {
                const avatarUrl = 'https://i.pinimg.com/originals/20/81/27/2081270ee56f88c770bff6bd05867e05.gif';
                await client.user.setAvatar(avatarUrl); 
                console.log('[ATLAS] Avatar updated from remote URL.'); 
            }
        } catch(e) { 
            console.error('[ATLAS] Avatar update failed:', e.message);
        }
        
        // Push commands
        const commands = [];
        for (const [name, cmd] of client.commands) {
            commands.push(cmd.data.toJSON());
        }

        const guildId = process.env.GUILD_ID;
        if (guildId) {
            try {
                const guild = await client.guilds.fetch(guildId);
                await guild.commands.set(commands);
                console.log(`[ATLAS] Sovereign Protocols synchronized for Guild: ${guild.name}`);
                
                // Optional: Clear global commands to avoid duplicates
                await client.application.commands.set([]);
                console.log('[ATLAS] Global protocols cleared to prevent duplicates.');
            } catch (e) {
                console.error('[ATLAS] Guild command sync failed:', e.message);
                await client.application.commands.set(commands);
            }
        } else {
            await client.application.commands.set(commands);
            console.log('[ATLAS] Sovereign Protocols synchronized globally.');
        }
    }
};
