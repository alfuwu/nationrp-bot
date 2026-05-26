const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { FACTIONS } = require('../../data/constants');
const { getNotificationChannel, isGM, sendToPlayer, ephemeralReply } = require('../../utils/helpers');
const { ANCESTRIES } = require('../../data/constants');

const ONE_DAY = 24 * 60 * 60 * 1000;

const FACTION_MECHANICS = {
    'Tyrannite':      { unlock: 15, unlockText: 'Vitale market access, Empire Ruler candidacy',          penalty: -20, penaltyText: 'Vitale embargo' },
    'Caossa':         { unlock: null, unlockText: 'Open trade routes + ore/metallurgy bonus',          penalty: -10, penaltyText: 'Trade embargo (Hostile relations)' },
    'Sciatic League': { unlock: null, unlockText: 'Open trade routes including Servus exchange',         penalty: -10, penaltyText: 'Trade embargo (Hostile relations)' },
    'The Mothers':    { unlock: 10, unlockText: 'Noble vitale upkeep halved for Sovereigns',             penalty: null, penaltyText: null },
    'The Fathers':    { unlock: 10, unlockText: 'Military recruitment cap +50%',                         penalty: null, penaltyText: null },
    'Atomic Guild':   { unlock: 15, unlockText: '+max(INT,WIS mod) to all rolls',                       penalty: -20, penaltyText: 'GM notification chance per tax tick' },
    'Rhagaia':        { unlock: null, unlockText: '⚠️ Mechanic details pending lorebook confirmation.',  penalty: null, penaltyText: null },
    'Sellesela':      { unlock: null, unlockText: '⚠️ Mechanic details pending lorebook confirmation.',  penalty: null, penaltyText: null },
    'Gaius':          { unlock: null, unlockText: '⚠️ Mechanic details pending lorebook confirmation.',  penalty: null, penaltyText: null },
    'Outer Being':    { unlock: null, unlockText: null, penalty: null, penaltyText: null },
    'The Sisters':    { unlock: null, unlockText: null, penalty: null, penaltyText: null },
    'The Warlocks':   { unlock: null, unlockText: null, penalty: null, penaltyText: null },
};

async function handleDiplomacy(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;
    const relations = await db.all('SELECT * FROM relations WHERE user_id=?', userId);
    const relMap = {};
    for (const r of relations) relMap[r.faction_name] = r;

    let lines = [];
    for (const faction of FACTIONS) {
        const score = relMap[faction]?.score || 0;
        const segs = Math.round(Math.min(10, Math.max(0, (score + 30) / 6)));
        // Color: green for positive, yellow for neutral, red for negative
        const green = score > 0 ? Math.min(10, Math.max(0, Math.round(score / 3))) : 0;
        const red = score < 0 ? Math.min(10, Math.max(0, Math.round(-score / 3))) : 0;
        const yellow = 10 - green - red;
        const bar = '🟩'.repeat(green) + '🟨'.repeat(yellow) + '🟥'.repeat(red);
        let tag;
        if (faction === 'Tyrannite' && score <= -20) tag = 'EMBARGOED';
        else if (score >= 15) tag = 'Allied';
        else if (score >= 0) tag = 'Neutral';
        else if (score >= -10) tag = 'Strained';
        else tag = 'Hostile';
        const scoreStr = `${score > 0 ? '+' : ''}${score}`.padStart(4);
        const name = faction.padEnd(16).substring(0, 16);
        lines.push(`\`${name} ${bar} ${scoreStr}  ${tag}\``);
    }

    // Player's own treaties and trade routes summary
    const treaties = await db.all("SELECT * FROM treaties WHERE (initiator_id=? OR partner_id=?) AND status='active'", userId, userId);
    const routes = await db.all("SELECT * FROM trade_routes WHERE (initiator_id=? OR partner_id=?) AND status NOT IN ('completed','broken')", userId, userId);
    const playerInfo = [];
    if (treaties.length > 0) playerInfo.push(`📜 **${treaties.length}** active treaty(s)`);
    else playerInfo.push('📜 No active treaties');
    if (routes.length > 0) playerInfo.push(`🔄 **${routes.length}** active trade route(s)`);
    else playerInfo.push('🔄 No trade routes');

    const embed = new EmbedBuilder()
        .setTitle('🤝 DIPLOMATIC LEDGER')
        .setDescription(`${playerInfo.join('  |  ')}\n\n${lines.join('\n')}`)
        .setColor(0x00BFFF);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`diplo_view_${userId}`)
        .setPlaceholder('Select a faction for detail...')
        .addOptions(FACTIONS.slice(0, 25).map(f => ({ label: f, value: f })));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_treaties_${userId}`).setLabel('View Treaties').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`diplo_treaty_${userId}`).setLabel('Propose Treaty').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_war_${userId}`).setLabel('⚔️ Declare War').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`diplo_gift_${userId}`).setLabel('🎁 Send Gift').setStyle(ButtonStyle.Success)
    );

    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), row, row2] });
}

async function handleFactionDetail(interaction, userId, factionName) {
    const db = interaction.client.db;
    if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this ledger may use it.');

    const rel = await db.get('SELECT * FROM relations WHERE user_id=? AND faction_name=?', userId, factionName);
    const score = rel?.score || 0;
    const mech = FACTION_MECHANICS[factionName] || {};
    const canBribe = !rel || !rel.last_bribe || (Date.now() - rel.last_bribe >= ONE_DAY);
    const now = Date.now();

    let desc = `**Current Standing:** ${score > 0 ? '+' : ''}${score}`;
    if (mech.unlock != null) {
        const unlocked = score >= mech.unlock;
        desc += `\n\n🔓 **Unlock at ${mech.unlock > 0 ? '+' : ''}${mech.unlock}:** ${mech.unlockText || ''} ${unlocked ? '✅' : '🔒'}`;
    }
    if (mech.penalty != null) {
        const triggered = score <= mech.penalty;
        desc += `\n\n⚠️ **Penalty at ${mech.penalty}:** ${mech.penaltyText || ''} ${triggered ? '🔴 Active' : ''}`;
    }
    if (mech.unlock == null && mech.penalty == null) {
        desc += `\n\n⚠️ *Mechanic details pending lorebook confirmation.*`;
    }

    const user = await db.get('SELECT balance, exotics FROM users WHERE id=?', userId);
    const cooldownNote = canBribe ? '' : '\n*(Bribe on cooldown — 24h)*';

    const embed = new EmbedBuilder()
        .setTitle(`🤝 ${factionName}`)
        .setDescription(desc)
        .setColor(0x00BFFF);

    const factionIndex = FACTIONS.indexOf(factionName);
    const components = [
        new ButtonBuilder().setCustomId(`diplo_bribe_gold_${userId}_${factionIndex}`).setEmoji('🪙').setLabel(`500 → +1`).setStyle(ButtonStyle.Primary).setDisabled(!canBribe || (user.balance || 0) < 500),
        new ButtonBuilder().setCustomId(`diplo_bribe_exotic_${userId}_${factionIndex}`).setEmoji('🍷').setLabel(`1 → +3`).setStyle(ButtonStyle.Success).setDisabled(!canBribe || (user.exotics || 0) < 1),
    ];
    // Submit to Styx: only for Tyrannite, only if player is Independent/Free Tribe and not already Styx
    if (factionName === 'Tyrannite') {
        const userRow = await db.get('SELECT ancestry FROM users WHERE id=?', userId);
        const house = ANCESTRIES[(userRow?.ancestry||'').toUpperCase()]?.house;
        if (house && !['TYRANNITE','RHAGAIA','SELLESELA','GAIUS','CAOSSA'].includes(house)) {
            components.push(new ButtonBuilder().setCustomId(`diplo_submit_styx_${userId}`).setLabel('🏛️ Submit to Styx').setStyle(ButtonStyle.Danger));
        }
    }
    components.push(new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(components);

    return interaction.editReply({ embeds: [embed], components: [row], content: cooldownNote || null });
}

async function handleBribe(interaction, userId, factionName, type) {
    const db = interaction.client.db;
    if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this ledger may use it.');

    const rel = await db.get('SELECT * FROM relations WHERE user_id=? AND faction_name=?', userId, factionName);
    if (rel && rel.last_bribe && (Date.now() - rel.last_bribe < ONE_DAY)) {
        return ephemeralReply(interaction, '⚠️ Bribe on cooldown. Wait 24 hours between bribes per faction.');
    }

    const user = await db.get('SELECT balance, exotics FROM users WHERE id=?', userId);
    const now = Date.now();

    if (type === 'gold') {
        if ((user.balance || 0) < 500) return ephemeralReply(interaction, '⚠️ Insufficient balance. Need 500 :coin:.');
        await db.run('UPDATE users SET balance=balance-500 WHERE id=?', userId);
        await db.run(
            'INSERT INTO relations (user_id, faction_name, score, last_bribe) VALUES (?,?,COALESCE((SELECT score FROM relations WHERE user_id=? AND faction_name=?),0)+1,?) ON CONFLICT(user_id,faction_name) DO UPDATE SET score=score+1, last_bribe=?',
            userId, factionName, userId, factionName, now, now
        );
        return interaction.update({ content: `✅ +1 relation with **${factionName}** for 500 :coin:.` });
    }

    if (type === 'exotic') {
        if ((user.exotics || 0) < 1) return ephemeralReply(interaction, '⚠️ Insufficient exotics. Need 1 🍷.');
        await db.run('UPDATE users SET exotics=exotics-1 WHERE id=?', userId);
        await db.run(
            'INSERT INTO relations (user_id, faction_name, score, last_bribe) VALUES (?,?,COALESCE((SELECT score FROM relations WHERE user_id=? AND faction_name=?),0)+3,?) ON CONFLICT(user_id,faction_name) DO UPDATE SET score=score+3, last_bribe=?',
            userId, factionName, userId, factionName, now, now
        );
        return interaction.update({ content: `✅ +3 relation with **${factionName}** for 1 🍷 Exotic.` });
    }
}

async function handleViewTreaties(interaction, userId) {
    const db = interaction.client.db;
    const treaties = await db.all(
        "SELECT * FROM treaties WHERE (initiator_id=? OR partner_id=?) AND status NOT IN ('completed','broken')",
        userId, userId
    );
    if (!treaties.length) return interaction.editReply({ content: 'No active treaties. Use **Propose Treaty** to negotiate with another player.\n\n*Treaties are binding. Only an admin can dissolve them immediately.*', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });

    const lines = treaties.map(t => {
        const partner = t.initiator_id === userId ? t.partner_id : t.initiator_id;
        const ending = t.status === 'ending' && t.broken_at ? `⏳ Ends <t:${Math.floor(t.broken_at/1000)}:R>` : t.status;
        return `**#${t.id}** | ${t.treaty_type.replace(/[-_]/g,' ')} with <@${partner}> | ${ending} | ${t.turns_active} turns`;
    });

    const embed = new EmbedBuilder().setTitle('📜 TREATIES').setColor(0x00BFFF).setDescription(lines.join('\n'));
    const components = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
    )];

    // End Treaty buttons
    for (const t of treaties) {
        if (t.status === 'active') {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`diplo_endtreaty_${userId}_${t.id}`).setLabel(`End #${t.id} (3-day)`).setStyle(ButtonStyle.Danger)
            ));
        }
    }

    return interaction.editReply({ embeds: [embed], components });
}

async function handleViewRoutes(interaction, userId) {
    const db = interaction.client.db;
    const routes = await db.all(
        "SELECT * FROM trade_routes WHERE (initiator_id=? OR partner_id=?) AND status NOT IN ('completed','broken')",
        userId, userId
    );
    if (!routes.length) return interaction.editReply({ content: 'No active trade routes. Use `/atlas traderoute propose` to create one.' });

    const lines = routes.map(r => {
        const partnerLabel = r.partner_type === 'player'
            ? `<@${r.initiator_id === userId ? r.partner_id : r.initiator_id}>` : r.partner_type;
        return `**#${r.id}** | ${partnerLabel} | Give: ${r.give_amount} ${r.give_resource} → Receive: ${r.receive_amount} ${r.receive_resource} | ${r.turns_remaining}/${r.duration_turns} turns | ${r.status}`;
    });

    const embed = new EmbedBuilder().setTitle('🔄 TRADE ROUTES').setColor(0x00BFFF).setDescription(lines.join('\n'));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleProposeTreaty(interaction, userId) {
    // Show treaty type select
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`diplo_treatysel_${userId}`)
        .setPlaceholder('Select treaty type...')
        .addOptions(
            { label: 'Trade Pact', value: 'trade-pact', description: 'Facilitates resource exchange.' },
            { label: 'Non-Aggression', value: 'non-aggression', description: 'Pledge to avoid hostile action.' },
            { label: 'Alliance', value: 'alliance', description: 'Military and diplomatic union.' }
        );

    const embed = new EmbedBuilder().setTitle('🤝 PROPOSE TREATY').setColor(0x00BFFF).setDescription('Select a treaty type, then choose a partner player.');
    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function handleTreatyTypeSelect(interaction, userId) {
    if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
    const treatyType = interaction.values[0];

    await interaction.deferUpdate();

    // Fetch active players for selection
    const db = interaction.client.db;
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", userId);
    if (!players.length) return interaction.editReply({ content: '⚠️ No other active players to propose a treaty with.', components: [] });

    const playerMenu = new StringSelectMenuBuilder()
        .setCustomId(`diplo_treatyplayer_${userId}_${treatyType}`)
        .setPlaceholder('Select a player...')
        .addOptions(players.slice(0, 25).map(p => ({
            label: `${p.ruler_name || p.username}${p.nation ? ' of ' + p.nation : ''}`,
            description: `ID: ${p.id}`,
            value: p.id
        })));

    const embed = new EmbedBuilder()
        .setTitle(`🤝 PROPOSE ${treatyType.replace(/[-_]/g, ' ').toUpperCase()}`)
        .setColor(0x00BFFF)
        .setDescription('Select the player you wish to form a treaty with:');

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(playerMenu), backRow] });
}

async function handleTreatyPlayerSelect(interaction, userId, treatyType) {
    if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
    const partnerId = interaction.values[0];
    const db = interaction.client.db;

    if (partnerId === userId) return ephemeralReply(interaction, '⚠️ Cannot propose a treaty to yourself.');

    const result = await db.run(
        'INSERT INTO treaties (initiator_id, partner_id, treaty_type, status) VALUES (?,?,?,"pending")',
        userId, partnerId, treatyType
    );
    const treatyId = result.lastID;

    const chan = await getNotificationChannel(interaction.client, { id: partnerId, notification_channel: null, last_tax_channel: null });
    if (chan) {
        const emb = new EmbedBuilder()
            .setTitle('🤝 TREATY PROPOSAL')
            .setDescription(`<@${userId}> proposes a **${treatyType.replace(/[-_]/g, ' ')}** treaty.\n\n*Treaties are binding. Only an admin can dissolve them.*`)
            .setColor(0xFFD700);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`treaty_accept_${treatyId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`treaty_reject_${treatyId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
        try { await chan.send({ content: `<@${partnerId}>`, embeds: [emb], components: [row] }); } catch (_) {}
    }

    await interaction.update({ content: `📨 Treaty proposal sent to <@${partnerId}>.`, embeds: [], components: [] });

    await sendToPlayer(interaction.client, interaction, partnerId, {
        embeds: [new EmbedBuilder().setTitle('🤝 TREATY PROPOSAL').setColor(0xFFD700)
            .setDescription(`<@${userId}> proposes a **${treatyType.replace(/[-_]/g, ' ')}** treaty.\n\n*Treaties are binding. Only an admin can dissolve them.*`)],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`treaty_accept_${treatyId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`treaty_reject_${treatyId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
        )]
    });
}

async function handleTreatyAccept(interaction, treatyId) {
    const db = interaction.client.db;
    const treaty = await db.get('SELECT * FROM treaties WHERE id=? AND partner_id=? AND status="pending"', treatyId, interaction.user.id);
    return ephemeralReply(interaction, '⚠️ This proposal is no longer valid.');

    await db.run('UPDATE treaties SET status="active" WHERE id=?', treatyId);
    const emb = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF88).setTitle('✅ TREATY ACCEPTED');
    await interaction.update({ embeds: [emb], components: [], content: interaction.message.content });

    const chan = await getNotificationChannel(interaction.client, { id: treaty.initiator_id, notification_channel: null, last_tax_channel: null });
    if (chan) {
        try { await chan.send({ content: `✅ <@${treaty.initiator_id}> — Your **${treaty.treaty_type.replace(/[-_]/g, ' ')}** treaty with <@${interaction.user.id}> was **accepted**.` }); } catch (_) {}
    }
}

async function handleTreatyReject(interaction, treatyId) {
    const db = interaction.client.db;
    const treaty = await db.get('SELECT * FROM treaties WHERE id=? AND partner_id=? AND status="pending"', treatyId, interaction.user.id);
    return ephemeralReply(interaction, '⚠️ This proposal is no longer valid.');

    await db.run(`UPDATE treaties SET status='broken' WHERE id=?`, treatyId);
    const emb = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFF0000).setTitle('❌ TREATY REJECTED');
    await interaction.update({ embeds: [emb], components: [], content: interaction.message.content });

    const chan = await getNotificationChannel(interaction.client, { id: treaty.initiator_id, notification_channel: null, last_tax_channel: null });
    if (chan) {
        try { await chan.send({ content: `❌ <@${treaty.initiator_id}> — Your **${treaty.treaty_type.replace(/[-_]/g, ' ')}** treaty with <@${interaction.user.id}> was **rejected**.` }); } catch (_) {}
    }
}

// Admin: dissolve a treaty
async function handleTreatyDissolve(interaction) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id)) return interaction.editReply({ content: 'Access Denied.' });
    const initiatorId = interaction.options.getString('initiator');
    const partnerId   = interaction.options.getString('partner');
    const type        = interaction.options.getString('type');
    const treaty = await db.get(
        'SELECT * FROM treaties WHERE initiator_id=? AND partner_id=? AND treaty_type=? AND status="active"',
        initiatorId, partnerId, type
    );
    if (!treaty) return interaction.editReply({ content: 'No active treaty found.' });
    await db.run(`UPDATE treaties SET status='broken' WHERE id=?`, treaty.id);
    for (const uid of [initiatorId, partnerId]) {
        const chan = await getNotificationChannel(interaction.client, { id: uid, notification_channel: null, last_tax_channel: null });
        if (chan) {
            try { await chan.send({ content: `⚠️ <@${uid}> Your **${type}** treaty has been dissolved by the High Command.` }); } catch (_) {}
        }
    }
    return interaction.editReply({ content: `⚖️ Treaty dissolved. Both parties notified.` });
}

async function handleWarMenu(interaction, userId) {
    return ephemeralReply(interaction, '⚠️ Only the player who opened this ledger may use it.');
    const emb = new EmbedBuilder()
        .setTitle('⚔️ DECLARE WAR')
        .setColor(0xFF0000)
        .setDescription([
            'Choose your form of attack:',
            '',
            '**Field Battle** — `/atlas military` (Battle)',
            'Open-field engagement. Dominars and Sovereigns may declare.',
            '',
            '**Siege** — `/atlas military` (Siege)',
            'Lay siege to an enemy settlement. Sovereigns only.',
            '',
            '⚠️ War consumes food supplies and requires GM approval.',
        ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [emb], components: [row] });
}

async function handleGiftMenu(interaction, userId) {
    return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
    const db = interaction.client.db;
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", userId);
    if (!players.length) return interaction.editReply({ content: '⚠️ No other active players to send gifts to.', components: [] });

    const playerMenu = new StringSelectMenuBuilder()
        .setCustomId(`diplo_giftplayer_${userId}`)
        .setPlaceholder('Select recipient...')
        .addOptions(players.slice(0, 25).map(p => ({
            label: `${p.ruler_name || p.username}${p.nation ? ' of ' + p.nation : ''}`,
            value: p.id
        })));

    const emb = new EmbedBuilder().setTitle('🎁 SEND GIFT').setColor(0x00FF88)
        .setDescription('Select a player to send a gift to.');
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`diplo_back_${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [emb], components: [new ActionRowBuilder().addComponents(playerMenu), backRow] });
}

async function handleGiftPlayerSelect(interaction, userId) {
    if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
    const partnerId = interaction.values[0];

    const resourceMenu = new StringSelectMenuBuilder()
        .setCustomId(`diplo_giftres_${userId}_${partnerId}`)
        .setPlaceholder('Select resource to gift...')
        .addOptions([
            { label: '💰 Balance', value: 'balance' },
            { label: '🥩 Food', value: 'food_surplus' },
            { label: '⚒️ Ores', value: 'ores' },
            { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
            { label: '🔩 Metallurgy', value: 'metallurgy' },
            { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🔗 Servus', value: 'servus' },
        ]);
    await interaction.deferUpdate();

    const emb = new EmbedBuilder().setTitle('🎁 SEND GIFT').setColor(0x00FF88).setDescription('Select the resource to send.');
    return interaction.editReply({ embeds: [emb], components: [new ActionRowBuilder().addComponents(resourceMenu)] });
}

async function handleModal(interaction, action, args) {
    if (action === 'diplo' && args[0] === 'giftmodal') {
        const db = interaction.client.db;
        const userId = args[1];
        const partnerId = args[2];
        const res = args[3];
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        return ephemeralReply(interaction, '⚠️ Invalid input.');

        const user = await db.get('SELECT * FROM users WHERE id=?', userId);
        return ephemeralReply(interaction, `⚠️ Insufficient ${res}.`);

        await db.run(`UPDATE users SET ${res}=${res}-? WHERE id=?`, amt, userId);
        await db.run(`UPDATE users SET ${res}=COALESCE(${res},0)+? WHERE id=?`, amt, partnerId);

        await sendToPlayer(interaction.client, interaction, partnerId, {
            content: `🎁 <@${userId}> sent you **${amt} ${res}**!`
        });
        return ephemeralReply(interaction, `🎁 Gifted **${amt} ${res}** to <@${partnerId}>.`);
    }
}

// Button handler for diplomacy module
async function handleButton(interaction, action, args) {
    if (action === 'diplo') {
        const sub = args[0];
        const uid = args[1];
        if (sub === 'treaties') { await interaction.deferUpdate(); return await handleViewTreaties(interaction, uid); }
        if (sub === 'routes') { await interaction.deferUpdate(); return await handleViewRoutes(interaction, uid); }
        if (sub === 'treaty') { await interaction.deferUpdate(); return await handleProposeTreaty(interaction, uid); }
        if (sub === 'war') { await interaction.deferUpdate(); return await handleWarMenu(interaction, uid); }
        if (sub === 'gift') { await interaction.deferUpdate(); return await handleGiftMenu(interaction, uid); }
        if (sub === 'endtreaty') {
            const treatyId = parseInt(args[2]);
            await interaction.deferUpdate();
            const db = interaction.client.db;
            const treaty = await db.get('SELECT * FROM treaties WHERE id=? AND (initiator_id=? OR partner_id=?) AND status=?', treatyId, uid, uid, 'active');
            if (!treaty) return interaction.editReply({ content: '⚠️ Treaty not found or already ending.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`diplo_back_${uid}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
            const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;
            await db.run("UPDATE treaties SET status='ending', broken_at=? WHERE id=?", threeDays, treatyId);
            return interaction.editReply({ content: `📜 Treaty #${treatyId} will end <t:${Math.floor(threeDays/1000)}:R>. 3-day grace period active.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`diplo_back_${uid}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }
        if (sub === 'back') { await interaction.deferUpdate(); return await handleDiplomacy(interaction); }
        if (sub === 'submit' && args[1] === 'styx') {
            await interaction.deferUpdate();
            const db = interaction.client.db;
            await db.run("UPDATE users SET rate_prest=MAX(-10,rate_prest-5), great_house='TYRANNITE' WHERE id=?", uid);
            return interaction.editReply({ content: '🏛️ You have submitted to the **Styx Empire**. Your prestige has fallen by **−5** but you are now under the Empire\'s protection. Siege by non-Styx players will trigger allied response.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`diplo_back_${uid}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }
        if (sub === 'bribe') {
            const bribeType = args[1];
            const uid = args[2];
            const idx = parseInt(args[3]);
            const factionName = FACTIONS[idx];
            if (!factionName) return ephemeralReply(interaction, '⚠️ Unknown faction.');
            return await handleBribe(interaction, uid, factionName, bribeType);
        }
    }
    if (action === 'treaty') {
        const sub = args[0];
        const tid = parseInt(args[1]);
        if (isNaN(tid)) return ephemeralReply(interaction, '⚠️ Invalid treaty ID.');
        if (sub === 'accept') return await handleTreatyAccept(interaction, tid);
        if (sub === 'reject') return await handleTreatyReject(interaction, tid);
    }
}

// Select menu handler
async function handleSelect(interaction, action, args) {
    if (action === 'diplo') {
        const sub = args[0];
        const uid = args[1];
        if (sub === 'view') {
            await interaction.deferUpdate();
            return await handleFactionDetail(interaction, uid, interaction.values[0]);
        }
        if (sub === 'treatysel') {
            return await handleTreatyTypeSelect(interaction, uid);
        }
        if (sub === 'treatyplayer') {
            return await handleTreatyPlayerSelect(interaction, uid, args[2]);
        }
        if (sub === 'giftplayer') {
            return await handleGiftPlayerSelect(interaction, uid);
        }
        if (sub === 'giftres') {
            const partnerId = args[2];
            const res = interaction.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`diplo_giftmodal_${uid}_${partnerId}_${res}`)
                .setTitle('🎁 Send Gift');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('amt').setLabel('Amount to send').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')
            ));
            return await interaction.showModal(modal);
        }
    }
}

module.exports = {
    handleDiplomacy, handleButton, handleSelect, handleModal
};
