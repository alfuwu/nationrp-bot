const { Events, EmbedBuilder } = require('discord.js');
const { BUILDINGS, RESOURCES, TERRAINS, ANCESTRIES, UPBRINGINGS, PROFESSIONS, FACTIONS, STAT_MAPPING } = require('../data/constants');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        const client = interaction.client;
        console.log(`[ATLAS] [${new Date().toISOString()}] Interaction received: ${interaction.type} (Name: ${interaction.commandName || interaction.customId})`);
        
        try {
            if (interaction.isAutocomplete()) {
                const focusedOption = interaction.options.getFocused(true);
                const db = client.db;
                
                if (focusedOption.name === 'user' || focusedOption.name === 'target' || focusedOption.name === 'partner') {
                    const users = await db.all('SELECT id, username, ruler_name FROM users WHERE status IN ("active", "pending")');
                    const q = focusedOption.value.toLowerCase();
                    const filtered = users.filter(u =>
                        (u.username || '').toLowerCase().includes(q) ||
                        (u.ruler_name || '').toLowerCase().includes(q)
                    );
                    await interaction.respond(filtered.slice(0, 25).map(u => {
                        const label = u.ruler_name
                            ? `${u.ruler_name} (${u.username || 'unknown'})`.slice(0, 100)
                            : (u.username || `User ${u.id}`).slice(0, 100);
                        return { name: label, value: u.id };
                    }));
                } else if (focusedOption.name === 'stat') {
                    const stats = Object.keys(STAT_MAPPING).map(k => ({ name: STAT_MAPPING[k].name, value: k }));
                    const filtered = stats.filter(s => s.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    await interaction.respond(filtered.slice(0, 25));
                } else if (focusedOption.name === 'substat') {
                    const stat = interaction.options.get('stat')?.value;
                    if (stat && STAT_MAPPING[stat]) {
                        const subs = STAT_MAPPING[stat].sub;
                        const filtered = subs.filter(s => s.toLowerCase().includes(focusedOption.value.toLowerCase()));
                        await interaction.respond(filtered.slice(0, 25).map(s => ({ name: s, value: s })));
                    } else {
                        await interaction.respond([]);
                    }
                } else if (focusedOption.name === 'town') {
                    const targetId = interaction.options.get('user')?.value;
                    if (targetId) {
                        const db = interaction.client.db;
                        const towns = await db.all('SELECT name FROM towns WHERE user_id = ?', targetId);
                        const filtered = towns.filter(t => (t.name || 'Unnamed').toLowerCase().includes(focusedOption.value.toLowerCase()));
                        await interaction.respond(filtered.slice(0, 25).map(t => ({ name: t.name || 'Unnamed', value: t.name || 'Unnamed' })));
                    } else {
                        await interaction.respond([]);
                    }
                } else if (focusedOption.name === 'id' && interaction.commandName === 'admin') {
                    const towns = await db.all(`
                        SELECT towns.id, towns.name, users.username
                        FROM towns
                        LEFT JOIN users ON users.id = towns.user_id
                    `);
                    const q = focusedOption.value.toLowerCase();
                    const filtered = towns.filter(t =>
                        (t.name || '').toLowerCase().includes(q) ||
                        (t.username || '').toLowerCase().includes(q) ||
                        String(t.id).includes(q)
                    );
                    await interaction.respond(filtered.slice(0, 25).map(t => ({
                        name: `${t.name || 'Unnamed'} #${t.id} \u2014 ${t.username || 'Unknown'}`.slice(0, 100),
                        value: String(t.id)
                    })));
                } else if (focusedOption.name === 'give_resource' || focusedOption.name === 'ask_resource' || focusedOption.name === 'receive_resource') {
                    const resKeys = Object.keys(RESOURCES);
                    const filtered = resKeys.filter(k => k.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    await interaction.respond(filtered.slice(0, 25).map(k => ({ name: RESOURCES[k].name, value: k.toLowerCase() })));
                } else if (focusedOption.name === 'terrain_type') {
                    const terrainKeys = Object.keys(TERRAINS);
                    const filtered = terrainKeys.filter(k => k.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    await interaction.respond(filtered.slice(0, 25).map(k => ({ name: TERRAINS[k].name, value: k })));
                } else if (focusedOption.name === 'value') {
                    const field = interaction.options.getString('field');
                    let list = [];
                    if (field === 'ancestry') list = Object.keys(ANCESTRIES).map(k => ({ name: ANCESTRIES[k].name, value: k }));
                    else if (field === 'upbringing') list = Object.keys(UPBRINGINGS).map(k => ({ name: UPBRINGINGS[k].name, value: k }));
                    else if (field === 'profession') list = Object.keys(PROFESSIONS).map(k => ({ name: PROFESSIONS[k].name, value: k }));
                    else if (field === 'terrain_type') list = Object.keys(TERRAINS).map(k => ({ name: TERRAINS[k].name, value: k }));
                    else if (field === 'status') list = [{ name: 'Pending', value: 'pending' }, { name: 'Active', value: 'active' }, { name: 'Dead', value: 'dead' }];
                    
                    const filtered = list.filter(i => i.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    await interaction.respond(filtered.slice(0, 25));
                } else if (focusedOption.name === 'faction') {
                    const filtered = FACTIONS.filter(f => f.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    await interaction.respond(filtered.slice(0, 25).map(f => ({ name: f, value: f })));
                }
                return;
            }

            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                // Persist username on every command so autocomplete always works
                if (client.db && interaction.user) {
                    client.db.run(
                        'UPDATE users SET username = ? WHERE id = ? AND (username IS NULL OR username != ?)',
                        interaction.user.username, interaction.user.id, interaction.user.username
                    ).catch(() => {});
                }

                await command.execute(interaction);
            }

            if (interaction.isButton()) {
                const [action, ...args] = interaction.customId.split('_');
                const atlasCmd = client.commands.get('atlas');

                if (action === 'purgeconfirm') {
                    if (args[0] === 'yes') {
                        const tid = args[1];
                        await client.db.run('DELETE FROM users WHERE id = ?', tid);
                        await client.db.run('DELETE FROM towns WHERE user_id = ?', tid);
                        await client.db.run('DELETE FROM buildings WHERE town_id IN (SELECT id FROM towns WHERE user_id = ?)', tid);
                        await client.db.run('DELETE FROM relations WHERE user_id = ?', tid);
                        await client.db.run('DELETE FROM treaties WHERE initiator_id = ? OR partner_id = ?', tid, tid);
                        await client.db.run('DELETE FROM trade_routes WHERE initiator_id = ? OR partner_id = ?', tid, tid);
                        await client.db.run('DELETE FROM gm_events WHERE user_id = ?', tid);
                        await client.db.run('DELETE FROM duels WHERE challenger_id = ? OR defender_id = ?', tid, tid);
                        await client.db.run('DELETE FROM bets WHERE bettor_id = ?', tid);
                        await interaction.update({ embeds: [new EmbedBuilder().setTitle('👤 USER PURGED').setDescription(`Lineage erased: <@${tid}>.`).setColor(0xFF0000)], components: [] });
                    } else await interaction.update({ content: 'Purge protocol cancelled.', embeds: [], components: [] });
                    return;
                }

                if (atlasCmd && atlasCmd.handleButton) {
                    await atlasCmd.handleButton(interaction, action, args);
                }
            }

            if (interaction.isModalSubmit()) {
                const [action, ...args] = interaction.customId.split('_');
                const atlasCmd = client.commands.get('atlas');
                if (atlasCmd && atlasCmd.handleModal) {
                    await atlasCmd.handleModal(interaction, action, args);
                }
            }
            
            if (interaction.isStringSelectMenu()) {
                const [action, ...args] = interaction.customId.split('_');
                const atlasCmd = client.commands.get('atlas');
                if (atlasCmd && atlasCmd.handleSelect) {
                    await atlasCmd.handleSelect(interaction, action, args);
                }
            }
        } catch (error) {
            console.error('[ATLAS] INTERACTION ERROR:', error);
            const content = '⚠️ An internal error occurred while processing this interaction.';
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ content });
                } else {
                    await interaction.reply({ content, ephemeral: true });
                }
            } catch (e) {
                console.error('[ATLAS] Fatal interaction failure:', e.message);
            }
        }
    }
};
