const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { BUILDINGS, TERRAINS, EMOJIS } = require('../../data/constants');

async function handleSettlePrompt(interaction) {
    const embed = new EmbedBuilder().setTitle('🏕️ NO SETTLEMENTS FOUND').setColor(0xFF0000).setDescription('You must settle a town before accessing the town dashboard.');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('town_settle').setLabel('Settle New Town').setStyle(ButtonStyle.Success));
    return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleTownGUI(interaction) {
    const db = interaction.client.db;
    const towns = await db.all('SELECT * FROM towns WHERE user_id = ?', interaction.user.id);
    if (!towns.length) return await handleSettlePrompt(interaction);

    const embed = new EmbedBuilder().setTitle('🏘️ TOWN MANAGEMENT').setColor(0x00BFFF).setDescription('Select a settlement to manage:');
    const menu = new StringSelectMenuBuilder().setCustomId('town_select').setPlaceholder('Choose a settlement...').addOptions(
        towns.slice(0, 25).map(t => ({ 
            label: t.name || 'Unnamed Town', 
            description: `${TERRAINS[t.terrain_type]?.name || 'Unknown Terrain'} | ${t.plots_total || 0} plots`, 
            value: String(t.id), 
            emoji: '🏡' 
        }))
    );
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('town_settle').setLabel('Settle New Town').setStyle(ButtonStyle.Success));

    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), row] });
}

async function renderTownView(interaction, townId) {
    const db = interaction.client.db;
    const town = await db.get('SELECT * FROM towns WHERE id = ?', townId);
    if (!town) return interaction.editReply({ content: '⚠️ Settlement not found.' });

    const buildings = await db.all('SELECT * FROM buildings WHERE town_id = ?', townId);
    let bText = buildings.map(b => {
        const bd = BUILDINGS[b.type.toUpperCase()];
        const ready = b.ready_at ? (Date.now() >= b.ready_at ? '' : ` 🚧 <t:${Math.floor(b.ready_at / 1000)}:R>`) : '';
        return `• ${bd?.name || b.type}${ready}`;
    }).join('\n');
    if (!bText) bText = '*No structures.*';

    const terrain = TERRAINS[town.terrain_type];
    let plotsUsed = buildings.reduce((s, b) => s + (BUILDINGS[b.type.toUpperCase()]?.plots || 1), 0);
    
    const embed = new EmbedBuilder()
        .setTitle(`🏡 ${town.name}`)
        .setColor(0x00BFFF)
        .addFields(
            { name: '🌍 Terrain', value: terrain?.name?.toUpperCase() || 'UNKNOWN', inline: true },
            { name: '🗺️ Plots', value: `${plotsUsed} / ${town.plots_total}`, inline: true },
            { name: '🏗️ Buildings', value: bText === '*No structures.*' ? '*None*' : `${buildings.length} total`, inline: true }
        )
        .setDescription(`**Structure Ledger:**\n${bText}`)
        .setImage(terrain?.img || null)
        .setFooter({ text: `Fertility: ${town.fertility}% | Efficiency: ${Math.min(100, 50 + Math.floor(town.fertility/2))}%` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`town_buildmenu_${townId}`).setLabel('Build').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`town_upgrademenu_${townId}`).setLabel('Upgrade').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`town_demolishmenu_${townId}`).setLabel('Demolish').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`town_rename_${townId}`).setLabel('Rename').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`town_back_null`).setLabel('← Dashboard').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleButton(interaction, action, args) {
    const db = interaction.client.db;
    const sub = args[0];

    if (action === 'town') {
        if (sub === 'settle') {
            const modal = new ModalBuilder().setCustomId('townsettle_modal').setTitle('🏕️ Settle New Town');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('town_name').setLabel('Town Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));
            return await interaction.showModal(modal);
        }
        
        const townId = args[1];
        if (sub === 'back') {
            await interaction.deferUpdate();
            if (!townId || townId === 'null') return await handleTownGUI(interaction);
            return await renderTownView(interaction, townId);
        }

        if (sub === 'buildmenu') {
            await interaction.deferUpdate();
            const town = await db.get('SELECT * FROM towns WHERE id = ?', townId);
            const bldgs = await db.all('SELECT type FROM buildings WHERE town_id = ?', townId);
            let plotsUsed = bldgs.reduce((s, b) => s + (BUILDINGS[b.type.toUpperCase()]?.plots || 1), 0);
            const remaining = town.plots_total - plotsUsed;
            const user = await db.get('SELECT wealth FROM users WHERE id = ?', interaction.user.id);
            const userWealth = user.wealth || 0;

            // Tier 1 buildings that fit in plots
            const fitsPlots = Object.entries(BUILDINGS).filter(([k, b]) => b.tier === 1 && b.plots <= remaining);
            const affordable = fitsPlots.filter(([k, b]) => userWealth >= b.cost);

            if (fitsPlots.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle('🔨 BUILD STRUCTURE').setColor(0xFF0000)
                        .setDescription(`⚠️ **No plots remaining!**\n\n${town.name}: **${remaining}** plots left. Demolish a structure or settle a new town.\nYour Wealth: **${userWealth} ⚖️**`)],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))]
                });
            }
            if (affordable.length === 0) {
                const cheapest = fitsPlots.reduce((min, [k, b]) => b.cost < min.cost ? b : min, fitsPlots[0][1]);
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle('🔨 BUILD STRUCTURE').setColor(0xFF0000)
                        .setDescription(`⚠️ **Insufficient Wealth!**\n\nCheapest structure: **${cheapest.name}** (${cheapest.cost} ⚖️)\nYour Wealth: **${userWealth} ⚖️**\nPlots: **${remaining}** remaining`)],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))]
                });
            }
            
            const menu = new StringSelectMenuBuilder().setCustomId(`town_buildsel_${townId}`).setPlaceholder('Select a structure...').addOptions(affordable.slice(0, 25).map(([k, b]) => ({ label: `${b.name} (${b.cost}⚖️, ${b.plots} plots)`, description: b.desc.substring(0, 50), value: k, emoji: b.emoji || '🏗️' })));
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔨 BUILD STRUCTURE').setColor(0x00BFFF).setDescription(`**${town.name}** — ${remaining} plots remaining\nYour Wealth: **${userWealth} ⚖️**`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }

        if (sub === 'upgrademenu') {
            await interaction.deferUpdate();
            const town = await db.get('SELECT * FROM towns WHERE id = ?', townId);
            const bldgs = await db.all('SELECT type FROM buildings WHERE town_id = ? AND (ready_at IS NULL OR ready_at <= ?)', townId, Date.now());
            if (!bldgs.length) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⬆️ UPGRADE STRUCTURE').setColor(0xFF0000).setDescription('⚠️ No structures have been built in this settlement yet. Build base structures first.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
            
            const builtTypes = bldgs.map(b => b.type.toUpperCase());
            const upgradeable = Object.entries(BUILDINGS).filter(([k, b]) => b.upgrade_from && builtTypes.includes(b.upgrade_from));
            
            if (!upgradeable.length) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⬆️ UPGRADE STRUCTURE').setColor(0xFF0000).setDescription('⚠️ No current structures have upgrades available.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
            
            const menu = new StringSelectMenuBuilder().setCustomId(`town_upgradesel_${townId}`).setPlaceholder('Select a structure to upgrade...').addOptions(upgradeable.slice(0, 25).map(([k, b]) => ({ label: `${BUILDINGS[b.upgrade_from].name} → ${b.name} (${b.cost}⚖️)`, value: k })));
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⬆️ UPGRADE STRUCTURE').setColor(0x00FF88).setDescription(`**${town.name}**`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }

        if (sub === 'demolishmenu') {
            await interaction.deferUpdate();
            const town = await db.get('SELECT * FROM towns WHERE id = ?', townId);
            const bldgs = await db.all('SELECT type FROM buildings WHERE town_id = ?', townId);
            if (!bldgs.length) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔴 DEMOLISH STRUCTURE').setColor(0xFF0000).setDescription('⚠️ No structures exist to demolish in this settlement.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
            
            const menu = new StringSelectMenuBuilder().setCustomId(`town_demolishsel_${townId}`).setPlaceholder('Select a structure...').addOptions(bldgs.slice(0, 25).map(b => ({ label: `${BUILDINGS[b.type.toUpperCase()]?.name || b.type}`, value: b.type })));
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔴 DEMOLISH STRUCTURE').setColor(0xFF4444).setDescription(`**${town.name}**`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }

        if (sub === 'rename') {
            const modal = new ModalBuilder()
                .setCustomId(`townrename_${townId}`)
                .setTitle('🏷️ Rename Town');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('new_name').setLabel('New Town Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)
            ));
            return await interaction.showModal(modal);
        }
    }

    if (action === 'buildconfirm') {
        const townId = args[0];
        const bType = args.slice(1).join('_');
        await interaction.deferUpdate();
        const bData = BUILDINGS[bType];
        await db.run('UPDATE users SET wealth = wealth - ? WHERE id = ?', bData.cost, interaction.user.id);
        const readyAt = Date.now() + 3600000;
        await db.run('INSERT INTO buildings (town_id, type, level, ready_at) VALUES (?, ?, 1, ?)', townId, bType.toLowerCase(), readyAt);
        return await renderTownView(interaction, townId);
    }
    
    if (action === 'upgradeconfirm') {
        const townId = args[0];
        const bType = args.slice(1).join('_');
        await interaction.deferUpdate();
        const bData = BUILDINGS[bType];
        if (!bData || !bData.upgrade_from) return interaction.editReply({ content: '⚠️ Invalid upgrade.', components: [] });

        // Check plot space
        const town = await db.get('SELECT * FROM towns WHERE id=?', townId);
        const bldgs = await db.get('SELECT COUNT(*) as cnt FROM buildings WHERE town_id=?', townId);
        const oldPlots = BUILDINGS[bData.upgrade_from]?.plots || 0;
        const newPlots = bData.plots || 0;
        if (town && town.plots_total) {
            // Estimate: since we can't easily sum all plots, just check the new building doesn't exceed
            // Better: count all buildings and their plots
            const allBldgs = await db.all('SELECT type FROM buildings WHERE town_id=?', townId);
            let plotsUsed = 0;
            for (const b of allBldgs) {
                plotsUsed += (BUILDINGS[b.type.toUpperCase()]?.plots || 1);
            }
            if (plotsUsed - oldPlots + newPlots > town.plots_total) {
                return interaction.editReply({ content: `⚠️ Not enough plots. Need ${newPlots - oldPlots} more.`, components: [] });
            }
        }

        await db.run('UPDATE users SET wealth = wealth - ? WHERE id = ?', bData.cost, interaction.user.id);
        await db.run(
            'DELETE FROM buildings WHERE rowid = (SELECT rowid FROM buildings WHERE town_id = ? AND type = ? LIMIT 1)',
            townId, bData.upgrade_from.toLowerCase()
        );
        const readyAt = Date.now() + 3600000;
        await db.run('INSERT INTO buildings (town_id, type, level, ready_at) VALUES (?, ?, 1, ?)', townId, bType.toLowerCase(), readyAt);
        return await renderTownView(interaction, townId);
    }
    
    if (action === 'demolishconfirm') {
        const townId = args[0];
        const bType = args.slice(1).join('_');
        await interaction.deferUpdate();
        const bData = BUILDINGS[bType.toUpperCase()];
        const refund = Math.floor((bData?.cost || 0) * 0.5);
        await db.run('UPDATE users SET wealth = wealth + ? WHERE id = ?', refund, interaction.user.id);
        // Delete only ONE row of the specified type
        await db.run(
            'DELETE FROM buildings WHERE rowid = (SELECT rowid FROM buildings WHERE town_id = ? AND type = ? LIMIT 1)',
            townId, bType.toLowerCase()
        );
        return await renderTownView(interaction, townId);
    }
}

async function handleModal(interaction, action, args) {
    const db = interaction.client.db;

    // Town rename modal
    if (action === 'townrename') {
        const townId = parseInt(args[0]);
        const newName = interaction.fields.getTextInputValue('new_name')?.trim();
        await interaction.deferUpdate();

        const user = await db.get('SELECT balance FROM users WHERE id=?', interaction.user.id);
        if ((user.balance || 0) < 1000) return interaction.editReply({ content: '⚠️ Renaming costs **1,000 :coin:**.' });

        const check = await db.get('SELECT id FROM towns WHERE user_id=? AND LOWER(name)=?', interaction.user.id, newName.toLowerCase());
        if (check) return interaction.editReply({ content: '⚠️ You already have a town with that name.' });

        await db.run('UPDATE users SET balance=balance-1000 WHERE id=?', interaction.user.id);
        await db.run('UPDATE towns SET name=? WHERE id=?', newName, townId);
        return interaction.editReply({ content: `✅ Town renamed to **${newName}**.` });
    }

    if (action === 'townsettle' && args[0] === 'modal') {
        const name = interaction.fields.getTextInputValue('town_name')?.trim();
        await interaction.deferUpdate();
        
        const user = await db.get('SELECT wealth FROM users WHERE id = ?', interaction.user.id);
        const settlements = await db.all('SELECT id FROM towns WHERE user_id = ?', interaction.user.id);
        const cost = settlements.length > 0 ? 5000 : 0;
        const requiredWealth = settlements.length > 0 ? 5000 : 1000;

        if ((user.wealth || 0) < requiredWealth) return interaction.editReply({ content: `⚠️ You need at least **${requiredWealth.toLocaleString()} ⚖️ Wealth** in your bank to found a new settlement.` });

        const check = await db.get('SELECT id FROM towns WHERE LOWER(name) = ?', name.toLowerCase());
        if (check) return interaction.editReply({ content: '⚠️ Settlement name already exists.' });
        
        const terrainKeys = Object.keys(TERRAINS);
        const tType = terrainKeys[Math.floor(Math.random() * terrainKeys.length)];
        const maxPlots = TERRAINS[tType].plots || 10;
        const plots = Math.floor(Math.random() * 61) + 25; // 25–85
        const fert = Math.floor(Math.random() * 81) + 20;

        if (cost > 0) await db.run('UPDATE users SET wealth = wealth - ? WHERE id = ?', cost, interaction.user.id);
        await db.run('INSERT INTO towns (user_id, name, terrain_type, plots_total, fertility) VALUES (?, ?, ?, ?, ?)', interaction.user.id, name, tType, plots, fert);
        await db.run('UPDATE users SET food_surplus = COALESCE(food_surplus, 0) + 500 WHERE id = ?', interaction.user.id);
        
        if (settlements.length === 0) {
            await interaction.followUp({ content: '💡 **TIPS FROM HIGH COMMAND:** Your first settlement is founded! Every town needs **Food** and **Ores** to thrive. Build a **Farm** or **Livestock** immediately to feed your growing population.', ephemeral: true });
        }
        return await handleTownGUI(interaction);
    }
}

async function handleSelect(interaction, action, args) {
    const sub = args[0];
    const townId = args[1];

    if (action === 'town') {
        if (sub === 'select') {
            await interaction.deferUpdate();
            return await renderTownView(interaction, interaction.values[0]);
        }
        
        if (sub === 'buildsel') {
            await interaction.deferUpdate();
            const bType = interaction.values[0];
            const bd = BUILDINGS[bType];
            const embed = new EmbedBuilder().setTitle('🏗️ CONFIRM CONSTRUCTION').setColor(0x00FF88).setDescription(`Are you sure you want to build **${bd.name}**?\n\nCost: ${bd.cost}⚖️\nTime: 1 hour`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`buildconfirm_${townId}_${bType}`).setLabel('Confirm Build').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
            );
            return interaction.editReply({ embeds: [embed], components: [row] });
        }
        
        if (sub === 'upgradesel') {
            await interaction.deferUpdate();
            const bType = interaction.values[0];
            const bd = BUILDINGS[bType];
            const embed = new EmbedBuilder().setTitle('🏗️ CONFIRM UPGRADE').setColor(0x00FF88).setDescription(`Are you sure you want to upgrade to **${bd.name}**?\n\nCost: ${bd.cost}⚖️\nTime: 1 hour`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`upgradeconfirm_${townId}_${bType}`).setLabel('Confirm Upgrade').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
            );
            return interaction.editReply({ embeds: [embed], components: [row] });
        }
        
        if (sub === 'demolishsel') {
            await interaction.deferUpdate();
            const bType = interaction.values[0];
            const bd = BUILDINGS[bType.toUpperCase()];
            const refund = Math.floor((bd?.cost || 0) * 0.5);
            const embed = new EmbedBuilder().setTitle('🔴 CONFIRM DEMOLITION').setColor(0xFF0000).setDescription(`Are you sure you want to demolish **${bd?.name || bType}**?\n\nRefund: ${refund}⚖️`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`demolishconfirm_${townId}_${bType}`).setLabel('Confirm Demolish').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`town_back_${townId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );
            return interaction.editReply({ embeds: [embed], components: [row] });
        }
    }
}

module.exports = {
    handleTownGUI, renderTownView, handleSettlePrompt, handleButton, handleModal, handleSelect
};
