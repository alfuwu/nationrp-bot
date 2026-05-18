const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const { RESOURCES, TERRAIN_MULTIPLIERS, BUILDINGS, ANCESTRIES } = require('../../data/constants');
const {
    calcStabMultiplier, getCharBonuses, calcNobleState, formatWarningBanner,
    getPlayerRank, isVitaleFree, getNotificationChannel, calcMaintenance,
    resolveAtlasHQ, GREAT_HOUSES, sendToPlayer, getActivePlayers
} = require('../../utils/helpers');

async function handleTax(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;
    const user = await db.get('SELECT * FROM users WHERE id = ?', userId);

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (now - (user.last_tax || 0) < ONE_DAY) {
        const remaining = ONE_DAY - (now - (user.last_tax || 0));
        const hrs = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        return interaction.editReply({ content: `⏳ You can collect taxes again in **${hrs}h ${mins}m**.` });
    }

    // ── STEP 3: Building production loop ─────────────────────────────────────
    const towns = await db.all('SELECT * FROM towns WHERE user_id = ?', userId);
    let totalWealth = 0, totalFoodProd = 0, totalFoodCost = 0, totalOresProd = 0;
    let totalOreConsume = 0, totalMetProd = 0, totalExoticProd = 0;
    let totalStabBonus = 0, totalWealthMultBonus = 0;

    for (const t of towns) {
        const mult = TERRAIN_MULTIPLIERS[t.terrain_type] || { food: 1.0, wealth: 1.0, ore: 1.0 };
        const bldgs = await db.all(
            'SELECT type FROM buildings WHERE town_id = ? AND (ready_at IS NULL OR ready_at <= ?)',
            t.id, now
        );
        for (const b of bldgs) {
            const bd = BUILDINGS[b.type.toUpperCase()];
            if (!bd) continue;
            totalWealth         += (bd.income_wealth      || 0) * mult.wealth;
            totalFoodProd       += (bd.food_prod          || 0) * mult.food;
            totalFoodCost       += (bd.food_cost          || 0);
            totalOresProd       += (bd.ore_prod           || 0) * mult.ore;
            totalOreConsume     += (bd.ore_consumption    || 0);
            totalMetProd        += (bd.metallurgy_prod    || 0);
            totalExoticProd     += (bd.exotic_prod        || 0);
            totalStabBonus      += (bd.stab_bonus         || 0);
            totalWealthMultBonus += (bd.wealth_mult_bonus || 0);
        }
    }

    // ── STEP 4: Ancestry bonuses ─────────────────────────────────────────────
    const ancestryKey = (user.ancestry || '').toUpperCase();
    const ancestryData = ANCESTRIES[ancestryKey];
    if (ancestryData?.house === 'CAOSSA') {
        totalMetProd  = Math.floor(totalMetProd  * 1.3);
        totalOresProd = Math.floor(totalOresProd * 1.2);
    }

    // ── STEP 5: Apply multipliers ────────────────────────────────────────────
    const charBonuses = getCharBonuses(user);
    const stabMult    = calcStabMultiplier(user.rate_stab);
    const servusMult  = 1 + ((user.servus || 0) * 0.02);
    const wealthMult  = 1 + totalWealthMultBonus;

    const finalWealth  = Math.floor(totalWealth * servusMult * stabMult * charBonuses.wealthBonus * wealthMult);
    const finalFoodNet = Math.floor((totalFoodProd * charBonuses.foodBonus) - totalFoodCost);
    const finalOres    = totalOresProd - totalOreConsume;
    const finalMet     = Math.floor(totalMetProd * stabMult);
    const finalExotics = totalExoticProd;
    const stabDrain    = Math.floor((user.servus || 0) / 5);

    // ── STEP 6: The Mothers faction bonus ────────────────────────────────────
    const mothersRel = await db.get(
        'SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'The Mothers'
    );

    // ── STEP 7: Rank-aware Vitale handling ───────────────────────────────────
    const rank    = getPlayerRank(user);
    const vFree   = isVitaleFree(user.ancestry);
    const { nobles, vitaleNeeded: rawVitaleNeeded, inGracePeriod } = calcNobleState(user);
    let vitaleNeeded = rawVitaleNeeded;
    if (mothersRel?.score >= 10 && rank === 'SOVEREIGN') vitaleNeeded = Math.ceil(vitaleNeeded / 2);

    let vitaleStabPenalty = 0, vitaleDeducted = 0, vitaleText = '';

    if (vFree || rank !== 'SOVEREIGN') {
        vitaleText = nobles > 0
            ? `${nobles} nobles (${vitaleNeeded} 💧/tick — subsidized by Imperial Academy)`
            : `No nobles yet (population below 200)`;
    } else if (inGracePeriod) {
        vitaleText = `${vitaleNeeded} 💧 — grace period (${3 - (user.tax_count || 0)} ticks left)`;
    } else if ((user.vitale || 0) >= vitaleNeeded && nobles > 0) {
        vitaleDeducted = vitaleNeeded;
        vitaleText = `${vitaleNeeded} 💧 paid ✅`;
    } else if (nobles > 0) {
        vitaleStabPenalty = -2;
        vitaleText = `${vitaleNeeded} 💧 ⚠️ DEFICIT (−2 Stability)`;
    }

    // ── STEP 8: Net stability + single DB UPDATE ─────────────────────────────
    const netStab = totalStabBonus - stabDrain + vitaleStabPenalty;
    const channelId = interaction.channelId;

    await db.run(`
        UPDATE users SET
            balance      = balance + 100,
            wealth       = COALESCE(wealth,0) + ?,
            food_surplus = COALESCE(food_surplus,0) + ?,
            ores         = MAX(0, COALESCE(ores,0) + ?),
            metallurgy   = COALESCE(metallurgy,0) + ?,
            exotics      = COALESCE(exotics,0) + ?,
            vitale       = COALESCE(vitale,0) - ?,
            rate_stab    = MAX(-10, MIN(10, rate_stab + ?)),
            last_tax     = ?,
            tax_count    = COALESCE(tax_count,0) + 1,
            last_tax_channel = ?,
            tax_notified = 0
        WHERE id = ?`,
        finalWealth, finalFoodNet, finalOres, finalMet, finalExotics,
        vitaleDeducted, netStab, now, channelId, userId
    );

    if (rank === 'SOVEREIGN' && !vFree && !inGracePeriod && nobles > 0) {
        const prestChange = vitaleDeducted > 0 ? +2 : -3;
        await db.run(
            'UPDATE users SET rate_prest = MAX(-10, MIN(10, rate_prest + ?)) WHERE id = ?',
            prestChange, userId
        );
    }

    // ── STEP 9: Atomic Guild low-relation check ──────────────────────────────
    const ag = await db.get(
        'SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'Atomic Guild'
    );
    if (ag?.score <= -20) {
        const r = Math.random();
        let gmAlert = null;
        if      (r < 0.005) gmAlert = `☠️ ASSASSINATION PLOT detected — Atomic Guild targeting ${interaction.user.username}. Review and decide.`;
        else if (r < 0.025) gmAlert = `🔗 SERVUS UPRISING RISK — Atomic Guild influence on ${interaction.user.username}. Review.`;
        else if (r < 0.075) gmAlert = `⚠️ REBEL ACTIVITY — Atomic Guild. Targeting ${interaction.user.username}.`;
        if (gmAlert) {
            await resolveAtlasHQ(interaction.client,
                new EmbedBuilder().setTitle('🔮 ATOMIC GUILD ALERT').setDescription(gmAlert).setColor(0x333333)
            );
        }
    }

    // ── STEP 10: Build embeds ───────────────────────────────────────────────
    const updatedUser = await db.get('SELECT rate_stab, rate_prest FROM users WHERE id=?', userId);
    const warnBanner  = formatWarningBanner(updatedUser.rate_stab, updatedUser.rate_prest);
    const warnColor   = warnBanner?.startsWith('🔴') ? 0xFF4444 : warnBanner ? 0xFFCC00 : null;
    const houseData   = ancestryData ? GREAT_HOUSES[ancestryData.house] : null;
    const houseStr    = houseData ? `${houseData.emoji} ${houseData.name}` : 'Independent';
    const armyMaint   = calcMaintenance(user);
    const servusWarn  = stabDrain > 0 && (user.rate_stab - stabDrain) <= -3
        ? '\n⚠️ **SERVUS UNREST RISING** — Rebellion may fire at −5 Stability.' : '';

    const econDesc = [
        `**Taxes Collected:** +100 :coin:`,
        `**Polity Wealth:** +${finalWealth} ⚖️`,
        ``,
        `**Resources Generated:**`,
        `🥩 Food: ${finalFoodNet >= 0 ? '+' : ''}${finalFoodNet}`,
        `⚒️ Ores: ${finalOres >= 0 ? '+' : ''}${finalOres}${finalOres < 0 ? ' ⚠️ Furnace consuming more than mines produce!' : ''}`,
        finalMet > 0 ? `🔩 Metallurgy: +${finalMet}` : null,
        finalExotics > 0 ? `🍷 Exotics: +${finalExotics}` : null,
        ``,
        `*Multipliers: Stability(×${stabMult.toFixed(2)}) · Servus(×${servusMult.toFixed(2)}) · INT(×${charBonuses.wealthBonus.toFixed(2)}) · WIS(×${charBonuses.foodBonus.toFixed(2)})*`,
        `Army upkeep: ${armyMaint} 🥩/day (charged by daily scheduler)`,
        servusWarn || null,
        warnBanner  || null,
    ].filter(Boolean).join('\n');

    const popDesc = [
        `**Rank:** ${rank} | **House:** ${houseStr}`,
        `**Commoners:** ${user.pop_commoners || 0}`,
        `⚔️ Infantry: ${user.mil_infantry || 0} | 🐎 Cavalry: ${user.mil_cavalry || 0} | 🏹 Ranged: ${user.mil_ranged || 0} | 🪨 Siege: ${user.mil_siege || 0}`,
        `**Nobles:** ${vitaleText}`,
        `**Servus drain:** ${stabDrain > 0 ? `−${stabDrain} Stability` : 'None'}`,
        `**Stability:** ${updatedUser.rate_stab}/10 | **Prestige:** ${updatedUser.rate_prest}/10`,
        warnBanner || null,
    ].filter(Boolean).join('\n');

    const econEmbed = new EmbedBuilder().setTitle('📊 ECONOMIC REPORT').setColor(warnColor || 0x00FF88).setDescription(econDesc);
    const popEmbed  = new EmbedBuilder().setTitle('👥 POPULATION REPORT').setColor(warnColor || 0x00BFFF).setDescription(popDesc);
    return interaction.editReply({ embeds: [econEmbed, popEmbed] });
}

async function handlePopulation(interaction) {
    const db = interaction.client.db;
    const user = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);

    const { nobles, vitaleNeeded: rawVitaleNeeded, inGracePeriod } = calcNobleState(user);
    const commoners = user.pop_commoners ?? 100;
    const famineActive = (user.food_surplus ?? 0) <= 0;
    const stabDrain   = Math.floor((user.servus || 0) / 5);
    const rank        = getPlayerRank(user);
    const ancestryData = ANCESTRIES[(user.ancestry || '').toUpperCase()];
    const houseData    = ancestryData ? GREAT_HOUSES[ancestryData.house] : null;
    const houseStr     = houseData ? `${houseData.emoji} ${houseData.name}` : 'Independent';
    const armyMaint    = calcMaintenance(user);

    // The Mothers bonus for vitale display
    const mothersRel = await db.get(
        'SELECT score FROM relations WHERE user_id=? AND faction_name=?', interaction.user.id, 'The Mothers'
    );
    let vitaleNeeded = rawVitaleNeeded;
    if (mothersRel?.score >= 10 && rank === 'SOVEREIGN') vitaleNeeded = Math.ceil(vitaleNeeded / 2);

    const isSubsidized = !user.nation;
    const hasEnoughVitale = isSubsidized || (user.vitale ?? 0) >= vitaleNeeded;
    let vitaleStr;
    if (isSubsidized || rank !== 'SOVEREIGN' || isVitaleFree(user.ancestry)) {
        vitaleStr = nobles > 0
            ? `${nobles} (${vitaleNeeded} 💧 subsidized)` : `None (pop below 200)`;
    } else if (inGracePeriod) {
        vitaleStr = `${nobles} (${vitaleNeeded} 💧 grace)`;
    } else if (!hasEnoughVitale) {
        vitaleStr = `${nobles} (${vitaleNeeded} 💧 ⚠️ DEFICIT)`;
    } else {
        vitaleStr = `${nobles} (${vitaleNeeded} 💧 ✅)`;
    }

    const servusWarn = (user.servus || 0) > 0 && (user.rate_stab ?? 0) - stabDrain <= -3
        ? ` ⚠️ Rebellion risk` : '';

    const warnBanner = formatWarningBanner(user.rate_stab, user.rate_prest);
    const desc = [
        `**Rank:** ${rank} | **House:** ${houseStr}`,
        `**Commoners:** ${commoners}`,
        `⚔️ Inf: ${user.mil_infantry || 0} | 🐎 Cav: ${user.mil_cavalry || 0} | 🏹 Rng: ${user.mil_ranged || 0} | 🪨 Sie: ${user.mil_siege || 0}`,
        (user.mercs_temp || 0) > 0 ? `🗡️ Mercs: ${user.mercs_temp} *(disband at turn end)*` : null,
        `Army upkeep: ${armyMaint} 🥩/day`,
        ``,
        `Food: ${famineActive ? '🔴 FAMINE — −1%/day!' : '✅'}`,
        `Nobles: ${vitaleStr}`,
        `Servus: ${user.servus || 0}${servusWarn}${stabDrain > 0 ? ` (−${stabDrain} Stab)` : ''}`,
        warnBanner ? `\n${warnBanner}` : null,
    ].filter(Boolean).join('\n');

    const color = warnBanner
        ? (warnBanner.startsWith('🔴') ? 0xFF4444 : 0xFFCC00)
        : 0x00BFFF;

    const embed = new EmbedBuilder().setTitle('👥 CENSUS REPORT').setColor(color).setDescription(desc);
    return interaction.editReply({ embeds: [embed] });
}

async function handleBalance(interaction) {
    const db = interaction.client.db;
    const user = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);
    const servusCount = user.servus || 0;
    const stabDrain   = Math.floor(servusCount / 5);
    const armyMaint   = calcMaintenance(user);

    let servusLine = `🔗 Servus: ${servusCount}`;
    if (servusCount > 0) {
        servusLine += ` *(−${stabDrain} Stability/tick)*`;
        if ((user.rate_stab ?? 0) - stabDrain <= -3) servusLine += ` ⚠️ Rebellion risk`;
    }

    const embed = new EmbedBuilder().setTitle('💰 TREASURY').setColor(0xFFD700)
        .setDescription([
            `:coin: Balance: ${user.balance || 0}  |  ⚖️ Wealth: ${user.wealth || 0}`,
            ``,
            `🥩 Food: ${user.food_surplus || 0}  |  ⚒️ Ores: ${user.ores || 0}`,
            `🔩 Metallurgy: ${user.metallurgy || 0}  |  💧 Vitale: ${user.vitale || 0}`,
            `🍷 Exotics: ${user.exotics || 0}`,
            servusLine,
            ``,
            `⚔️ Inf: ${user.mil_infantry || 0}  🐎 Cav: ${user.mil_cavalry || 0}  🏹 Rng: ${user.mil_ranged || 0}  🪨 Sie: ${user.mil_siege || 0}`,
            `🗡️ Mercs: ${user.mercs_temp || 0}  |  Upkeep: ${armyMaint} 🥩/day`,
        ].join('\n'));
    return interaction.editReply({ embeds: [embed] });
}

async function handleDonate(interaction) {
    const db = interaction.client.db;
    const amount = interaction.options.getInteger('amount');
    const user   = await db.get('SELECT balance FROM users WHERE id = ?', interaction.user.id);
    const cost   = amount * 1000;
    if ((user.balance || 0) < cost) return interaction.editReply({ content: `⚠️ Insufficient Balance. You need **${cost.toLocaleString()} :coin:** to convert **${amount} ⚖️**.` });
    await db.run('UPDATE users SET balance = balance - ?, wealth = COALESCE(wealth, 0) + ? WHERE id = ?', cost, amount, interaction.user.id);
    return interaction.editReply({ content: `✅ Converted **${cost.toLocaleString()} :coin:** → **${amount} ⚖️** Polity Wealth.` });
}

async function handleGift(interaction) {
    const db       = interaction.client.db;
    const targetId = interaction.options.getString('target');
    const res      = interaction.options.getString('resource');
    const amount   = interaction.options.getInteger('amount');
    if (amount <= 0) return interaction.editReply({ content: '⚠️ Amount must be positive.' });
    if (targetId === interaction.user.id) return interaction.editReply({ content: '⚠️ You cannot gift to yourself.' });
    const target = await db.get('SELECT id FROM users WHERE id = ?', targetId);
    if (!target) return interaction.editReply({ content: '⚠️ Target lineage not found.' });
    const user = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);
    if ((user[res] || 0) < amount) return interaction.editReply({ content: `⚠️ Insufficient ${res}. You have **${user[res] || 0}**.` });
    await db.run(`UPDATE users SET ${res} = ${res} - ? WHERE id = ?`, amount, interaction.user.id);
    await db.run(`UPDATE users SET ${res} = COALESCE(${res}, 0) + ? WHERE id = ?`, amount, targetId);
    return interaction.editReply({ content: `🎁 Gifted **${amount} ${res.toUpperCase()}** to <@${targetId}>.` });
}

async function handleTrade(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;

    const routes = await db.all("SELECT * FROM trade_routes WHERE initiator_id=? AND status NOT IN ('completed','broken')", userId);
    const routeList = routes.length > 0
        ? routes.map(r => `**#${r.id}**: ${r.give_amount} ${r.give_resource} → ${r.partner_type === 'player' ? `<@${r.partner_id}>` : r.partner_type} | ${r.turns_remaining}t left`).join('\n')
        : 'No active trade routes.';

    const emb = new EmbedBuilder()
        .setTitle('🤝 TRADE CENTER')
        .setColor(0x00BFFF)
        .setDescription([
            '**1. One-Time Trade** — exchange resources immediately with a player.',
            '**2. Trade Routes** — continuous supply routes with factions or players.',
            '',
            `**Active Routes (${routes.length}):**`,
            routeList,
        ].join('\n'));

    const players = await getActivePlayers(db, userId);
    const oneTimeMenu = new StringSelectMenuBuilder()
        .setCustomId(`trade_onedone_${userId}`)
        .setPlaceholder('1️⃣ One-Time Trade — select a player...')
        .addOptions(players.length > 0 ? players.slice(0, 25).map(p => ({
            label: `${p.ruler_name || p.username}${p.nation ? ' of ' + p.nation : ''}`,
            value: p.id
        })) : [{ label: 'No players available', value: 'none' }]);

    const routeMenu = new StringSelectMenuBuilder()
        .setCustomId(`trade_route_${userId}`)
        .setPlaceholder('2️⃣ Trade Routes — manage...')
        .addOptions([
            { label: 'View My Routes', value: 'list', description: 'Show all active trade routes' },
            { label: 'New Route (Faction)', value: 'new', description: 'Continuous route with Styx/Sciatic/Caossa' },
            { label: 'New Route (Player)', value: 'newplayer', description: 'Continuous route with a player' },
        ]);

    if (routes.length > 0) {
        routeMenu.addOptions(routes.slice(0, 23).map(r => ({
            label: `Cancel #${r.id}: ${r.give_resource}→${r.partner_type}`,
            value: `cancel_${r.id}`,
            description: `${r.give_amount} ${r.give_resource} per turn`
        })));
    }

    return interaction.editReply({ embeds: [emb], components: [
        new ActionRowBuilder().addComponents(oneTimeMenu),
        new ActionRowBuilder().addComponents(routeMenu)
    ]});
}

async function handleEmpire(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;
    const emb = await renderEmpireEmbed(db);

    const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'Tyrannite');
    const isEmbargoed = rel ? rel.score <= -20 : false;

    if (isEmbargoed) {
        emb.setFooter({ text: 'Embargoed — seek Vitale through player trade.' });
    }

    return interaction.editReply({ embeds: [emb], components: [] });
}

async function renderEmpireEmbed(db) {
    const settings    = await db.all('SELECT * FROM global_settings');
    const getS        = (k) => settings.find(s => s.key === k)?.value;
    const playerCount = (await db.get('SELECT COUNT(*) as cnt FROM users WHERE status = ?', 'active'))?.cnt || 1;
    const vitaleBase  = parseInt(getS('vitale_base')) || 15;
    const vitaleSold  = parseInt(getS('vitale_sold_week')) || 0;
    const vitalePool  = vitaleBase + (10 * playerCount);
    const demandRatio = vitaleSold / Math.max(1, vitalePool);
    const vitalePrice = Math.floor(50 * (1 + demandRatio * 4));

    // Styx Empire stats
    const STYX_HOUSES = ['TYRANNITE', 'RHAGAIA', 'SELLESELA', 'GAIUS', 'CAOSSA'];
    const styxPlayers = await db.all("SELECT id, mil_militia, mil_spearmen, mil_swordsman, mil_shield, mil_cavalry, mil_ranged, mil_siege, nation, ruler_name, username FROM users WHERE status='active'");
    const { ANCESTRIES } = require('../../data/constants');
    let vassalCount = 0, totalStyxMil = 0;
    const vassalNames = [];
    for (const p of styxPlayers) {
        const ancRow = await db.get('SELECT ancestry FROM users WHERE id=?', p.id || '');
        const house = ANCESTRIES[(ancRow?.ancestry || '').toUpperCase()]?.house;
        if (house && STYX_HOUSES.includes(house)) {
            vassalCount++;
            totalStyxMil += (p.mil_militia||0)+(p.mil_spearmen||0)+(p.mil_swordsman||0)+(p.mil_shield||0)+(p.mil_cavalry||0)+(p.mil_ranged||0)+(p.mil_siege||0);
            const name = p.ruler_name || p.username || 'Unknown';
            vassalNames.push(p.nation ? `${name} of ${p.nation}` : name);
        }
    }
    const vassalStr = vassalCount > 0 ? `${vassalCount} vassal(s) | ⚔️ ${totalStyxMil} total military` : 'No vassals sworn';

    return new EmbedBuilder().setTitle('🏛️ STYX EMPIRE DASHBOARD').setColor(0x6A0DAD)
        .setDescription([
            `**Vitale Market**`,
            `Pool: ${vitalePool} 💧 | Sold: ${vitaleSold} 💧`,
            `Current Price: **${vitalePrice} ⚖️** per unit`,
            ``,
            `**Styx Empire Status**`,
            `${vassalStr}`,
            vassalNames.length > 0 ? `Nations: ${vassalNames.join(', ')}` : '',
            ``,
            `*Price rises with weekly demand. Market resets each Monday.*`,
        ].join('\n'));
}

async function handleButton(interaction, action, args) {
    const db = interaction.client.db;

    // Trade: "Set What You Give" button
    if (action === 'tmodalg') {
        const targetId = args[0];
        const modal = new ModalBuilder().setCustomId(`tmodalgm_${targetId}`).setTitle('🎁 Set What You Give');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('res').setLabel('Resource (wealth, food_surplus, etc)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('wealth')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100'))
        );
        return await interaction.showModal(modal);
    }

    // Trade: "Set What You Request" button
    if (action === 'tmodalr') {
        const targetId = args[0];
        const modal = new ModalBuilder().setCustomId(`tmodalrm_${targetId}`).setTitle('🤝 Set What You Request');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('res').setLabel('Resource (wealth, food_surplus, etc)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('food_surplus')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50'))
        );
        return await interaction.showModal(modal);
    }

    if (action === 'vitale' && args[0] === 'buy') {
        const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', interaction.user.id, 'Tyrannite');
        if (rel && rel.score <= -20)
            return interaction.reply({ content: '🚫 Embargoed by Styx Empire.', ephemeral: true });

        const settings = await db.all('SELECT * FROM global_settings');
        const getS = k => settings.find(s => s.key === k)?.value;
        const pCount = (await db.get('SELECT COUNT(*) as cnt FROM users WHERE status=?', 'active'))?.cnt || 1;
        const vBase = parseInt(getS('vitale_base')) || 15;
        const vSold = parseInt(getS('vitale_sold_week')) || 0;
        const pool = vBase + (10 * pCount);
        const price = Math.floor(50 * (1 + (vSold / Math.max(1, pool)) * 4));

        const modal = new ModalBuilder().setCustomId(`vitale_modal_${price}`).setTitle(`💧 Buy Vitale — ${price}⚖️ each`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('amount').setLabel(`Price: ${price} ⚖️/unit`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('How many?')
        ));
        return await interaction.showModal(modal);
    }

    // Empire GUI: Faction trade select (handled in handleSelect)
    // Empire GUI: Back button
    if (action === 'empire' && args[0] === 'back') {
        await interaction.deferUpdate();
        return await handleEmpire(interaction);
    }
}

async function handleModal(interaction, action, args) {
    const db = interaction.client.db;

    // Trade: One-time trade immediate execution
    if (action === 'trade' && args[0] === 'onedonemod') {
        const userId = args[1];
        const partnerId = args[2];
        const giveRes = interaction.fields.getTextInputValue('give_res')?.trim().toLowerCase();
        const giveAmt = parseInt(interaction.fields.getTextInputValue('give_amt'));
        const recvRes = interaction.fields.getTextInputValue('recv_res')?.trim().toLowerCase();
        const recvAmt = parseInt(interaction.fields.getTextInputValue('recv_amt'));
        if (!giveRes || !recvRes || isNaN(giveAmt) || giveAmt <= 0 || isNaN(recvAmt) || recvAmt <= 0)
            return interaction.reply({ content: '⚠️ Invalid input.', ephemeral: true });
        if (giveRes === recvRes) return interaction.reply({ content: '⚠️ Cannot trade same resource.', ephemeral: true });

        const user = await db.get('SELECT * FROM users WHERE id=?', userId);
        const partner = await db.get('SELECT * FROM users WHERE id=? AND status=?', partnerId, 'active');
        if (!partner) return interaction.reply({ content: '⚠️ Partner not found.', ephemeral: true });
        if ((user[giveRes] || 0) < giveAmt) return interaction.reply({ content: `⚠️ Insufficient ${giveRes}.`, ephemeral: true });
        if ((partner[recvRes] || 0) < recvAmt) return interaction.reply({ content: `⚠️ Partner doesn't have enough ${recvRes}. Trade cancelled.`, ephemeral: true });

        // Execute immediate one-time trade
        await db.run(`UPDATE users SET ${giveRes}=${giveRes}-?, ${recvRes}=COALESCE(${recvRes},0)+? WHERE id=?`, giveAmt, recvAmt, userId);
        await db.run(`UPDATE users SET ${recvRes}=${recvRes}-?, ${giveRes}=COALESCE(${giveRes},0)+? WHERE id=?`, recvAmt, giveAmt, partnerId);

        await sendToPlayer(interaction.client, interaction, partnerId, {
            content: `🤝 <@${userId}> traded: You received **${giveAmt} ${giveRes}**, gave **${recvAmt} ${recvRes}**.`
        });
        return interaction.reply({ content: `✅ Trade complete: Gave **${giveAmt} ${giveRes}** → Received **${recvAmt} ${recvRes}** from <@${partnerId}>.`, ephemeral: true });
    }
    if (action === 'trade' && args[0] === 'facmod') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = args[3];
        const recvRes = args[4];
        const giveAmt = parseInt(interaction.fields.getTextInputValue('give_amt'));
        if (isNaN(giveAmt) || giveAmt <= 0)
            return interaction.reply({ content: '⚠️ Invalid input.', ephemeral: true });

        const user = await db.get('SELECT * FROM users WHERE id=?', userId);
        if ((user[giveRes] || 0) < giveAmt) return interaction.reply({ content: `⚠️ Insufficient ${giveRes.replace('_surplus','')}.`, ephemeral: true });

        // Relation gates
        if (faction === 'sciatic') {
            const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'Sciatic League');
            if (!rel || rel.score < 10) return interaction.reply({ content: '⚠️ Sciatic League requires relation ≥ 10.', ephemeral: true });
        }
        if (faction === 'caossa') {
            const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'Caossa');
            if (!rel || rel.score < 5) return interaction.reply({ content: '⚠️ Caossa requires relation ≥ 5.', ephemeral: true });
        }

        await db.run(
            "INSERT INTO trade_routes (initiator_id, partner_id, partner_type, give_resource, give_amount, receive_resource, receive_amount, duration_turns, turns_remaining, status) VALUES (?,NULL,?,?,?,?,?,?,?,'active')",
            userId, faction, giveRes, giveAmt, recvRes, 0, 1, 1
        );
        return interaction.reply({ content: `✅ Trade route established with **${faction.charAt(0).toUpperCase() + faction.slice(1)}**! Give ${giveAmt} ${giveRes.replace('_surplus','')} → receive ${recvRes.replace('_surplus','')} from them. Use \`/atlas trade\` to manage routes.`, ephemeral: true });
    }

    // Trade: Give modal submit
    if (action === 'tmodalgm') {
        const targetId = args[0];
        const res = interaction.fields.getTextInputValue('res')?.trim().toLowerCase();
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        if (!res || isNaN(amt) || amt <= 0) return interaction.reply({ content: '⚠️ Invalid input.', ephemeral: true });
        const user = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
        if ((user[res] || 0) < amt) return interaction.reply({ content: `⚠️ Insufficient ${res}.`, ephemeral: true });

        return interaction.reply({
            content: `✅ You will give **${amt} ${res}**.\nClick **Set What You Request** to continue.`,
            ephemeral: true
        });
    }

    // Trade: Request modal submit
    if (action === 'tmodalrm') {
        const targetId = args[0];
        const res = interaction.fields.getTextInputValue('res')?.trim().toLowerCase();
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        if (!res || isNaN(amt) || amt <= 0) return interaction.reply({ content: '⚠️ Invalid input.', ephemeral: true });

        return interaction.reply({
            content: `✅ You will request **${amt} ${res}**.\nBoth sides set — use the trade embed to confirm or start over.`,
            ephemeral: true
        });
    }

    if (action === 'vitale' && args[0] === 'modal') {
        const vitalePrice = parseInt(args[1]);
        const amount      = parseInt(interaction.fields.getTextInputValue('amount')?.trim());
        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: '⚠️ Invalid amount.', ephemeral: true });
        await interaction.deferUpdate();

        const user = await db.get('SELECT wealth, nation FROM users WHERE id = ?', interaction.user.id);
        if (!user.nation) return interaction.editReply({ content: '⚠️ You must found a nation to trade with the Styx Empire.', embeds: [], components: [] });

        const totalCost = vitalePrice * amount;
        if ((user.wealth || 0) < totalCost) return interaction.editReply({ content: `⚠️ Insufficient Wealth. You need **${totalCost} ⚖️**.`, embeds: [], components: [] });

        await db.run('UPDATE users SET wealth = wealth - ?, vitale = COALESCE(vitale, 0) + ? WHERE id = ?', totalCost, amount, interaction.user.id);
        await db.run('UPDATE global_settings SET value = CAST(value AS INTEGER) + ? WHERE key = ?', amount, 'vitale_sold_week');

        const emb = await renderEmpireEmbed(db);
        return interaction.editReply({ content: `💧 **Transaction complete.** Purchased **${amount} Vitale** for **${totalCost} ⚖️**.`, embeds: [emb], components: [] });
    }
}

async function handleSelect(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'empire' && args[0] === 'factiontrade') {
        const userId = args[1];
        const faction = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`empire_factionmodal_${userId}_${faction}`)
            .setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_res').setLabel('Resource you give').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('wealth')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel('Amount you give').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_res').setLabel('Resource you want').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('vitale'))
        );
        return await interaction.showModal(modal);
    }

    // Trade GUI: one-time trade — select a player
    if (action === 'trade' && args[0] === 'onedone') {
        const userId = args[1];
        const partnerId = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });
        if (partnerId === 'none' || partnerId === userId) return interaction.reply({ content: '⚠️ Invalid selection.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`trade_onedonemod_${userId}_${partnerId}`)
            .setTitle('🤝 One-Time Trade Offer');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_res').setLabel('Resource you give').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('wealth')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel('Amount you give').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_res').setLabel('Resource you want').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('food_surplus')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_amt').setLabel('Amount you want').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50'))
        );
        return await interaction.showModal(modal);
    }

    // Trade GUI: route management
    if (action === 'trade' && args[0] === 'route') {
        const userId = args[1];
        const val = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });

        if (val === 'list') {
            await interaction.deferUpdate();
            const tradeMod = require('./trade');
            return await tradeMod.handleTradeRouteList(interaction);
        }
        if (val === 'new') {
            await interaction.deferUpdate();
            const factionMenu = new StringSelectMenuBuilder()
                .setCustomId(`trade_facsel_${userId}`)
                .setPlaceholder('Select faction...')
                .addOptions(
                    { label: 'Styx Empire (Vitale)', value: 'styx' },
                    { label: 'Sciatic League', value: 'sciatic' },
                    { label: 'Caossa', value: 'caossa' }
                );
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏛️ Faction Trade').setColor(0x00BFFF).setDescription('Select a faction to establish a route with.')], components: [new ActionRowBuilder().addComponents(factionMenu)] });
        }
        if (val === 'newplayer') {
            const uid = args[1];
            const players = await getActivePlayers(db, uid);
            if (!players.length) return interaction.reply({ content: 'No other active players.', ephemeral: true });
            const pMenu = new StringSelectMenuBuilder().setCustomId(`trade_newplayer_${uid}`).setPlaceholder('Select a player...')
                .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
            await interaction.deferUpdate();
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 New Player Route').setColor(0x00BFFF).setDescription('Select a player for a continuous trade route.')], components: [new ActionRowBuilder().addComponents(pMenu)] });
        }
        if (val === 'cancel') return interaction.reply({ content: 'Select a specific route below to cancel it.', ephemeral: true });
        if (val.startsWith('cancel_')) {
            const routeId = parseInt(val.split('_')[1]);
            await interaction.deferUpdate();
            const tradeMod = require('./trade');
            return await tradeMod.handleTradeRouteCancel(interaction, routeId);
        }
    }

    // Trade: new player route selected
    if (action === 'trade' && args[0] === 'newplayer') {
        const initiatorId = args[1];
        const partnerId = interaction.values[0];
        if (interaction.user.id !== initiatorId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`trade_newplayer_mod_${initiatorId}_${partnerId}`)
            .setTitle('📨 Player Trade Route');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_res').setLabel('Resource you give').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('wealth')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel('Amount per turn').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_res').setLabel('Resource you receive').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('food_surplus')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_amt').setLabel('Amount per turn').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (1-10 turns)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('3'))
        );
        return await interaction.showModal(modal);
    }

    if (action === 'trade' && args[0] === 'facsel') {
        const userId = args[1];
        const faction = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });
        
        await interaction.deferUpdate();
        const resMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_facgive_${userId}_${faction}`)
            .setPlaceholder('Select resource you GIVE...')
            .addOptions([
                { label: '💰 Balance', value: 'balance' },
                { label: '⚖️ Wealth', value: 'wealth' },
                { label: '🥩 Food', value: 'food_surplus' },
                { label: '⚒️ Ores', value: 'ores' },
                { label: '🔩 Metallurgy', value: 'metallurgy' },
                { label: '🍷 Exotics', value: 'exotics' }
            ]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`).setColor(0x00BFFF).setDescription('What resource will you give?')], components: [new ActionRowBuilder().addComponents(resMenu)] });
    }

    if (action === 'trade' && args[0] === 'facgive') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });

        await interaction.deferUpdate();
        const resMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_facrecv_${userId}_${faction}_${giveRes}`)
            .setPlaceholder('Select resource you WANT...')
            .addOptions([
                { label: '💰 Balance', value: 'balance' },
                { label: '⚖️ Wealth', value: 'wealth' },
                { label: '🥩 Food', value: 'food_surplus' },
                { label: '⚒️ Ores', value: 'ores' },
                { label: '🔩 Metallurgy', value: 'metallurgy' },
                { label: '💧 Vitale', value: 'vitale' },
                { label: '🍷 Exotics', value: 'exotics' }
            ]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`).setColor(0x00BFFF).setDescription('What resource do you want in return?')], components: [new ActionRowBuilder().addComponents(resMenu)] });
    }

    if (action === 'trade' && args[0] === 'facrecv') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = args[3];
        const recvRes = interaction.values[0];
        if (interaction.user.id !== userId) return interaction.reply({ content: '⚠️ Only the player who opened this may use it.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`trade_facmod_${userId}_${faction}_${giveRes}_${recvRes}`)
            .setTitle(`Give ${giveRes.replace('_surplus','')} for ${recvRes.replace('_surplus','')}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel(`Amount of ${giveRes.replace('_surplus','')} to give`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100'))
        );
        return await interaction.showModal(modal);
    }
}

module.exports = {
    handleTax, handlePopulation, handleBalance, handleDonate, handleGift,
    handleTrade, handleEmpire, handleButton, handleModal, handleSelect
};
