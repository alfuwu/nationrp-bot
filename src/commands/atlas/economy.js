const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const { RESOURCES, TERRAIN_MULTIPLIERS, BUILDINGS, ANCESTRIES } = require('../../data/constants');
const {
    calcStabMultiplier, getCharBonuses, calcNobleState, formatWarningBanner,
    getPlayerRank, isVitaleFree, getNotificationChannel, calcMaintenance,
    resolveAtlasHQ, GREAT_HOUSES, sendToPlayer, getActivePlayers, safeReply, ephemeralReply
} = require('../../utils/helpers');

// Resource name encoding for customIds (food_surplus has an underscore that breaks parsing)
const encRes = r => r.replace('_surplus', 'SRP');
const decRes = r => r.replace('SRP', '_surplus');

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

    // Trade: "Set What You Give" button → opens give-modal
    if (action === 'tmodalg') {
        const targetId = args[0];
        const modal = new ModalBuilder().setCustomId(`tmodalg_${targetId}`).setTitle('🎁 Set What You Give');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('res').setLabel('Resource (wealth, food_surplus, etc)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('wealth')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100'))
        );
        return await interaction.showModal(modal);
    }

    // Trade: "Set What You Request" button → opens request-modal
    if (action === 'tmodalr') {
        const targetId = args[0];
        const modal = new ModalBuilder().setCustomId(`tmodalr_${targetId}`).setTitle('🤝 Set What You Request');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('res').setLabel('Resource (wealth, food_surplus, etc)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('food_surplus')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50'))
        );
        return await interaction.showModal(modal);
    }

    if (action === 'vitale' && args[0] === 'buy') {
        const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', interaction.user.id, 'Tyrannite');
        if (rel && rel.score <= -20)
            return ephemeralReply(interaction, '🚫 Embargoed by Styx Empire.');

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

    // Empire GUI: Back button
    if (action === 'empire' && args[0] === 'back') {
        await interaction.deferUpdate();
        return await handleEmpire(interaction);
    }

    // One-time trade: accept pending trade
    if (action === 'ta' && args[0] === 'accept') {
        const tradeId = parseInt(args[1]);
        const trade = await db.get("SELECT * FROM pending_trades WHERE id=? AND partner_id=? AND status='pending'", tradeId, interaction.user.id);
        return ephemeralReply(interaction, '⚠️ Trade no longer valid.');
        const initiator = await db.get('SELECT * FROM users WHERE id=?', trade.initiator_id);
        const partner   = await db.get('SELECT * FROM users WHERE id=?', trade.partner_id);
        return ephemeralReply(interaction, '⚠️ Player not found.');
        if ((initiator[trade.give_resource] || 0) < trade.give_amount)
            return ephemeralReply(interaction, `⚠️ Initiator no longer has enough ${trade.give_resource}. Trade cancelled.`);
        if ((partner[trade.recv_resource] || 0) < trade.recv_amount)
            return ephemeralReply(interaction, `⚠️ You no longer have enough ${trade.recv_resource}. Trade cancelled.`);

        await db.run(`UPDATE users SET ${trade.give_resource}=${trade.give_resource}-?, ${trade.recv_resource}=COALESCE(${trade.recv_resource},0)+? WHERE id=?`, trade.give_amount, trade.recv_amount, trade.initiator_id);
        await db.run(`UPDATE users SET ${trade.recv_resource}=${trade.recv_resource}-?, ${trade.give_resource}=COALESCE(${trade.give_resource},0)+? WHERE id=?`, trade.recv_amount, trade.give_amount, trade.partner_id);
        await db.run("UPDATE pending_trades SET status='completed' WHERE id=?", tradeId);

        await interaction.update({ content: `✅ Trade accepted! You gave **${trade.recv_amount} ${trade.recv_resource}** and received **${trade.give_amount} ${trade.give_resource}**.`, embeds: [], components: [] });
        await sendToPlayer(interaction.client, interaction, trade.initiator_id, {
            content: `✅ <@${trade.partner_id}> accepted your trade! You gave **${trade.give_amount} ${trade.give_resource}**, received **${trade.recv_amount} ${trade.recv_resource}**.`
        });
        return;
    }

    // One-time trade: decline pending trade
    if (action === 'ta' && args[0] === 'decline') {
        const tradeId = parseInt(args[1]);
        const trade = await db.get("SELECT * FROM pending_trades WHERE id=? AND partner_id=? AND status='pending'", tradeId, interaction.user.id);
        return ephemeralReply(interaction, '⚠️ Trade no longer valid.');
        await db.run("UPDATE pending_trades SET status='declined' WHERE id=?", tradeId);
        await interaction.update({ content: '❌ Trade declined.', embeds: [], components: [] });
        await sendToPlayer(interaction.client, interaction, trade.initiator_id, {
            content: `❌ <@${trade.partner_id}> declined your trade offer.`
        });
        return;
    }
    // Faction trade: "Enter Amount" button → opens the give-amount modal
    // (action='trade', args=['facconfirm', userId, faction, encRes(giveRes), encRes(recvRes)])
    if (action === 'trade' && args[0] === 'facconfirm') {
        const userId  = args[1];
        const faction = args[2];
        const giveRes = decRes(args[3]);
        const recvRes = decRes(args[4]);
        if (interaction.user.id !== userId)
            return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        const modal = new ModalBuilder()
            .setCustomId(`trade_facmod_${userId}_${faction}_${encRes(giveRes)}_${encRes(recvRes)}`)
            .setTitle(`Give ${giveRes.replace('_surplus', ' (Food)')} for ${recvRes.replace('_surplus', ' (Food)')}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('give_amt')
                    .setLabel(`Amount of ${giveRes.replace('_surplus', ' (Food)')} to give`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('100')
            )
        );
        return await interaction.showModal(modal);
    }
}

async function handleModal(interaction, action, args) {
    const db = interaction.client.db;

    // Trade: One-time trade — submit give/recv amounts → create pending proposal
    if (action === 'trade' && args[0] === 'onedonemod') {
        const userId = args[1];
        const partnerId = args[2];
        const giveRes = decRes(args[3]);  // decode encoded resource name
        const recvRes = decRes(args[4]);
        const giveAmt = parseInt(interaction.fields.getTextInputValue('give_amt'));
        const recvAmt = parseInt(interaction.fields.getTextInputValue('recv_amt'));
        if (isNaN(giveAmt) || giveAmt <= 0 || isNaN(recvAmt) || recvAmt <= 0)
            return ephemeralReply(interaction, '⚠️ Invalid amounts.');

        const user    = await db.get('SELECT * FROM users WHERE id=?', userId);
        const partner = await db.get("SELECT * FROM users WHERE id=? AND status='active'", partnerId);
        return ephemeralReply(interaction, '⚠️ Partner not found or inactive.');
        return ephemeralReply(interaction, `⚠️ Insufficient ${giveRes} (you have ${user[giveRes]||0}).`);

        const result = await db.run(
            'INSERT INTO pending_trades (initiator_id, partner_id, give_resource, give_amount, recv_resource, recv_amount, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
            userId, partnerId, giveRes, giveAmt, recvRes, recvAmt, 'pending', Date.now()
        );
        const tradeId = result.lastID;

        const propEmb = new EmbedBuilder().setTitle('🤝 TRADE PROPOSAL').setColor(0x00BFFF)
            .setDescription([
                `<@${userId}> proposes a trade:`,
                '',
                `They give you: **${giveAmt} ${giveRes.replace('_surplus','')}**`,
                `You give them: **${recvAmt} ${recvRes.replace('_surplus','')}**`,
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ta_accept_${tradeId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ta_decline_${tradeId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
        );
        await sendToPlayer(interaction.client, interaction, partnerId, { content: `<@${partnerId}>`, embeds: [propEmb], components: [row] });
        return ephemeralReply(interaction, `📨 Trade proposal sent to <@${partnerId}>. Awaiting their response.`);
    }

    // Trade: player route amounts modal submit
    if (action === 'trade' && args[0] === 'newplayer' && args[1] === 'mod') {
        const initiatorId = args[2];
        const partnerId   = args[3];
        const giveRes     = decRes(args[4]);  // decode
        const recvRes     = decRes(args[5]);
        const giveAmt  = parseInt(interaction.fields.getTextInputValue('give_amt'));
        const recvAmt  = parseInt(interaction.fields.getTextInputValue('recv_amt'));
        const duration = Math.min(10, Math.max(1, parseInt(interaction.fields.getTextInputValue('duration')) || 1));
        if (isNaN(giveAmt) || giveAmt <= 0 || isNaN(recvAmt) || recvAmt <= 0)
            return ephemeralReply(interaction, '⚠️ Invalid amounts.');

        const user = await db.get('SELECT * FROM users WHERE id=?', initiatorId);
        const target = await db.get("SELECT id FROM users WHERE id=? AND status='active'", partnerId);
        return ephemeralReply(interaction, '⚠️ Partner not found.');
        return ephemeralReply(interaction, '⚠️ Cannot trade with yourself.');

        const result = await db.run(
            'INSERT INTO trade_routes (initiator_id, partner_id, partner_type, give_resource, give_amount, receive_resource, receive_amount, duration_turns, turns_remaining, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
            initiatorId, partnerId, 'player', giveRes, giveAmt, recvRes, recvAmt, duration, duration, 'pending'
        );
        const routeId = result.lastID;

        const { getNotificationChannel } = require('../../utils/helpers');
        const chan = await getNotificationChannel(interaction.client, { id: partnerId, notification_channel: null, last_tax_channel: null });
        if (chan) {
            const { EmbedBuilder: Emb, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
            const propEmb = new EmbedBuilder().setTitle('🤝 TRADE ROUTE PROPOSAL').setColor(0x00BFFF)
                .setDescription([`<@${initiatorId}> proposes a route:`, '', `Give: **${giveAmt} ${giveRes.replace('_surplus','')}** → Receive: **${recvAmt} ${recvRes.replace('_surplus','')}**`, `Duration: ${duration} turns`].join('\n'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`traderoute_a_${routeId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`traderoute_r_${routeId}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
            );
            try { await chan.send({ content: `<@${partnerId}>`, embeds: [propEmb], components: [row] }); } catch (_) {}
        }
        return ephemeralReply(interaction, `📨 Route proposal sent to <@${partnerId}>. Awaiting their acceptance.`);
    }

    if (action === 'trade' && args[0] === 'facmod') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = decRes(args[3]);  // decode encoded resource
        const recvRes = decRes(args[4]);
        const giveAmt = parseInt(interaction.fields.getTextInputValue('give_amt'));
        if (isNaN(giveAmt) || giveAmt <= 0)
            return ephemeralReply(interaction, '⚠️ Invalid input.');

        const user = await db.get('SELECT * FROM users WHERE id=?', userId);
        return ephemeralReply(interaction, `⚠️ Insufficient ${giveRes.replace('_surplus','')}.`);

        // Embargo check — faction trade is blocked only when relations are Hostile (≤ −10).
        // Players in Strained (−10 < score < 0) or better may still trade freely.
        const FACTION_DB_NAMES = { styx: 'Tyrannite', sciatic: 'Sciatic League', caossa: 'Caossa' };
        const factionDbName = FACTION_DB_NAMES[faction];
        if (factionDbName) {
            const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, factionDbName);
            if (rel && rel.score <= -10)
                return ephemeralReply(interaction, `🚫 **Embargoed** — Your relations with **${factionDbName}** are Hostile (${rel.score}). Bribe or gift them above −10 to resume trading.`);
        }

        await db.run(
            "INSERT INTO trade_routes (initiator_id, partner_id, partner_type, give_resource, give_amount, receive_resource, receive_amount, duration_turns, turns_remaining, status) VALUES (?,NULL,?,?,?,?,?,?,?,'active')",
            userId, faction, giveRes, giveAmt, recvRes, 0, 1, 1
        );
        return ephemeralReply(interaction, `✅ Trade route established with **${faction.charAt(0).toUpperCase() + faction.slice(1)}**! Give ${giveAmt} ${giveRes.replace('_surplus','')} → receive ${recvRes.replace('_surplus','')} from them. Use \`/atlas trade\` to manage routes.`);
    }

    // Trade: Give modal submit (action = 'tmodalg', args[0] = targetId)
    if (action === 'tmodalg') {
        const res = interaction.fields.getTextInputValue('res')?.trim().toLowerCase();
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        return ephemeralReply(interaction, '⚠️ Invalid input.');
        const user = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
        return ephemeralReply(interaction, `⚠️ Insufficient ${res}.`);
        return ephemeralReply(interaction, `✅ You will give **${amt} ${res}**.\nClick **Set What You Request** to continue.`);
    }

    // Trade: Request modal submit (action = 'tmodalr', args[0] = targetId)
    if (action === 'tmodalr') {
        const res = interaction.fields.getTextInputValue('res')?.trim().toLowerCase();
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        return ephemeralReply(interaction, '⚠️ Invalid input.');
        return ephemeralReply(interaction, `✅ You will request **${amt} ${res}**.\nBoth sides set — use the trade embed to confirm or start over.`);
    }

    if (action === 'vitale' && args[0] === 'modal') {
        const vitalePrice = parseInt(args[1]);
        const amount      = parseInt(interaction.fields.getTextInputValue('amount')?.trim());
        return ephemeralReply(interaction, '⚠️ Invalid amount.');
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
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

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

    // Trade GUI: one-time trade — select a player → show give-resource dropdown
    if (action === 'trade' && args[0] === 'onedone') {
        const userId = args[1];
        const partnerId = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        if (partnerId === 'none' || partnerId === userId) return ephemeralReply(interaction, '⚠️ Invalid selection.');
        await interaction.deferUpdate();
        const RESOURCE_OPTIONS = [
            { label: '💰 Balance (coins)', value: 'balance' },
            { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🥩 Food', value: 'food_surplus' },
            { label: '⚒️ Ores', value: 'ores' },
            { label: '🔩 Metallurgy', value: 'metallurgy' },
            { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
        ];
        const giveMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_odgive_${userId}_${partnerId}`)
            .setPlaceholder('What will YOU give?')
            .addOptions(RESOURCE_OPTIONS);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤝 ONE-TIME TRADE').setColor(0x00BFFF).setDescription(`Trading with <@${partnerId}>\n\n**Step 1:** What resource will you give?`)], components: [new ActionRowBuilder().addComponents(giveMenu)] });
    }

    // One-time trade: give-resource selected → show recv-resource dropdown
    if (action === 'trade' && args[0] === 'odgive') {
        const userId = args[1];
        const partnerId = args[2];
        const giveRes = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        await interaction.deferUpdate();
        const RESOURCE_OPTIONS = [
            { label: '💰 Balance (coins)', value: 'balance' },
            { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🥩 Food', value: 'food_surplus' },
            { label: '⚒️ Ores', value: 'ores' },
            { label: '🔩 Metallurgy', value: 'metallurgy' },
            { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
        ].filter(o => o.value !== giveRes);
        const recvMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_odrecv_${userId}_${partnerId}_${encRes(giveRes)}`)
            .setPlaceholder('What do you WANT in return?')
            .addOptions(RESOURCE_OPTIONS);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤝 ONE-TIME TRADE').setColor(0x00BFFF).setDescription(`Trading with <@${partnerId}>\nYou give: **${giveRes.replace('_surplus',' (Food)')}**\n\n**Step 2:** What resource do you want?`)], components: [new ActionRowBuilder().addComponents(recvMenu)] });
    }

    // One-time trade: recv-resource selected → show amounts modal
    if (action === 'trade' && args[0] === 'odrecv') {
        const userId = args[1];
        const partnerId = args[2];
        const giveRes = decRes(args[3]);  // decode — may have been encoded as foodSRP
        const recvRes = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        const user = await db.get('SELECT * FROM users WHERE id=?', userId);
        const modal = new ModalBuilder()
            .setCustomId(`trade_onedonemod_${userId}_${partnerId}_${encRes(giveRes)}_${encRes(recvRes)}`)
            .setTitle('🤝 Trade Amounts');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel(`${giveRes.replace('_surplus',' (Food)')} to give (you have ${user[giveRes]||0})`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_amt').setLabel(`${recvRes.replace('_surplus',' (Food)')} to request`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50'))
        );
        return await interaction.showModal(modal);
    }

    // Trade GUI: route management
    if (action === 'trade' && args[0] === 'route') {
        const userId = args[1];
        const val = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

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
            if (!players.length) return ephemeralReply(interaction, 'No other active players.');
            const pMenu = new StringSelectMenuBuilder().setCustomId(`trade_newplayer_${uid}`).setPlaceholder('Select a player...')
                .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
            await interaction.deferUpdate();
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 New Player Route').setColor(0x00BFFF).setDescription('Select a player for a continuous trade route.')], components: [new ActionRowBuilder().addComponents(pMenu)] });
        }
        return ephemeralReply(interaction, 'Select a specific route below to cancel it.');
        if (val.startsWith('cancel_')) {
            const routeId = parseInt(val.split('_')[1]);
            await interaction.deferUpdate();
            const tradeMod = require('./trade');
            return await tradeMod.handleTradeRouteCancel(interaction, routeId);
        }
    }

    // Trade: new player route — player selected → give-resource dropdown
    if (action === 'trade' && args[0] === 'newplayer') {
        const initiatorId = args[1];
        const partnerId = interaction.values[0];
        if (interaction.user.id !== initiatorId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        await interaction.deferUpdate();
        const ROUTE_RESOURCES = [
            { label: '💰 Balance', value: 'balance' }, { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🥩 Food', value: 'food_surplus' }, { label: '⚒️ Ores', value: 'ores' },
            { label: '🔩 Metallurgy', value: 'metallurgy' }, { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
        ];
        const giveMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_plrgive_${initiatorId}_${partnerId}`)
            .setPlaceholder('What will you GIVE each turn?')
            .addOptions(ROUTE_RESOURCES);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 PLAYER TRADE ROUTE').setColor(0x00BFFF).setDescription(`Route with <@${partnerId}>\n\n**Step 1:** What resource will you give each turn?`)], components: [new ActionRowBuilder().addComponents(giveMenu)] });
    }

    // Player route: give selected → recv dropdown
    if (action === 'trade' && args[0] === 'plrgive') {
        const initiatorId = args[1];
        const partnerId = args[2];
        const giveRes = interaction.values[0];
        if (interaction.user.id !== initiatorId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        await interaction.deferUpdate();
        const ROUTE_RESOURCES = [
            { label: '💰 Balance', value: 'balance' }, { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🥩 Food', value: 'food_surplus' }, { label: '⚒️ Ores', value: 'ores' },
            { label: '🔩 Metallurgy', value: 'metallurgy' }, { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
        ].filter(o => o.value !== giveRes);
        const recvMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_plrrecv_${initiatorId}_${partnerId}_${encRes(giveRes)}`)
            .setPlaceholder('What will you RECEIVE each turn?')
            .addOptions(ROUTE_RESOURCES);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 PLAYER TRADE ROUTE').setColor(0x00BFFF).setDescription(`Route with <@${partnerId}>\nYou give: **${giveRes.replace('_surplus',' (Food)')}**\n\n**Step 2:** What resource will you receive?`)], components: [new ActionRowBuilder().addComponents(recvMenu)] });
    }

    // Player route: recv selected → amounts+duration modal
    if (action === 'trade' && args[0] === 'plrrecv') {
        const initiatorId = args[1];
        const partnerId = args[2];
        const giveRes = decRes(args[3]);  // decode
        const recvRes = interaction.values[0];
        if (interaction.user.id !== initiatorId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');
        const modal = new ModalBuilder()
            .setCustomId(`trade_newplayer_mod_${initiatorId}_${partnerId}_${encRes(giveRes)}_${encRes(recvRes)}`)
            .setTitle('📨 Route Amounts');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('give_amt').setLabel(`${giveRes.replace('_surplus',' (Food)')} to give per turn`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('recv_amt').setLabel(`${recvRes.replace('_surplus',' (Food)')} to receive per turn`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('50')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (1-10 turns)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('3'))
        );
        return await interaction.showModal(modal);
    }

    if (action === 'trade' && args[0] === 'facsel') {
        const userId = args[1];
        const faction = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

        await interaction.deferUpdate();

        // Embargo check — blocked only when relations are Hostile (≤ −10)
        const FACTION_DB_NAMES = { styx: 'Tyrannite', sciatic: 'Sciatic League', caossa: 'Caossa' };
        const factionDbName = FACTION_DB_NAMES[faction];
        if (factionDbName) {
            const rel = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, factionDbName);
            if (rel && rel.score <= -10)
                return interaction.editReply({ content: `🚫 **Embargoed** — Your relations with **${factionDbName}** are Hostile (${rel.score}). Bribe or gift them above −10 to resume trading.`, embeds: [], components: [] });
        }

        const resMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_facgive_${userId}_${faction}`)
            .setPlaceholder('Select resource you GIVE...')
            .addOptions([
                { label: '💰 Balance', value: 'balance' },
                { label: '⚖️ Wealth', value: 'wealth' },
                { label: '🥩 Food', value: 'food_surplus' },
                { label: '⚒️ Ores', value: 'ores' },
                { label: '🔩 Metallurgy', value: 'metallurgy' },
                { label: '🍷 Exotics', value: 'exotics' },
                { label: '🔗 Servus', value: 'servus' },
            ]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`).setColor(0x00BFFF).setDescription('What resource will you give?')], components: [new ActionRowBuilder().addComponents(resMenu)] });
    }

    if (action === 'trade' && args[0] === 'facgive') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = interaction.values[0];
        if (interaction.user.id !== userId) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

        await interaction.deferUpdate();
        // Build receive options — exclude the same resource being given to avoid no-op trades
        const ALL_FACTION_RESOURCES = [
            { label: '💰 Balance', value: 'balance' },
            { label: '⚖️ Wealth', value: 'wealth' },
            { label: '🥩 Food', value: 'food_surplus' },
            { label: '⚒️ Ores', value: 'ores' },
            { label: '🔩 Metallurgy', value: 'metallurgy' },
            { label: '💧 Vitale', value: 'vitale' },
            { label: '🍷 Exotics', value: 'exotics' },
            { label: '🔗 Servus', value: 'servus' },
        ].filter(o => o.value !== giveRes);
        const resMenu = new StringSelectMenuBuilder()
            .setCustomId(`trade_facrecv_${userId}_${faction}_${encRes(giveRes)}`)
            .setPlaceholder('Select resource you WANT...')
            .addOptions(ALL_FACTION_RESOURCES);
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`).setColor(0x00BFFF).setDescription('What resource do you want in return?')], components: [new ActionRowBuilder().addComponents(resMenu)] });
    }

    if (action === 'trade' && args[0] === 'facrecv') {
        const userId = args[1];
        const faction = args[2];
        const giveRes = decRes(args[3]);  // decode
        const recvRes = interaction.values[0];
        return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

        await interaction.deferUpdate();

        // Build preview info before opening modal
        let previewLines = [];
        if (faction === 'styx' && recvRes === 'vitale') {
            const settings = await db.all('SELECT * FROM global_settings');
            const getS = k => settings.find(s => s.key === k)?.value;
            const pCount = (await db.get('SELECT COUNT(*) as cnt FROM users WHERE status=?', 'active'))?.cnt || 1;
            const vBase = parseInt(getS('vitale_base')) || 15;
            const vSold = parseInt(getS('vitale_sold_week')) || 0;
            const pool = vBase + (10 * pCount);
            const price = Math.floor(50 * (1 + (vSold / Math.max(1, pool)) * 4));
            previewLines = [
                `**💱 Current Styx Exchange Rate**`,
                `**${price} ⚖️ Wealth** = **1 💧 Vitale**`,
                `Pool remaining: ${pool - vSold} / ${pool}`,
                '',
                'Enter how much **Wealth** to give in the next step.',
            ];
        } else {
            previewLines = [
                `**Exchange:** ${giveRes.replace('_surplus','')} → ${recvRes.replace('_surplus','')}`,
                '',
                'Enter how much you want to give in the next step.',
            ];
        }

        const previewEmb = new EmbedBuilder()
            .setTitle(`🤝 Trade with ${faction.charAt(0).toUpperCase() + faction.slice(1)}`)
            .setColor(0x00BFFF)
            .setDescription(previewLines.join('\n'));

        const confirmBtn = new ButtonBuilder()
            .setCustomId(`trade_facconfirm_${userId}_${faction}_${encRes(giveRes)}_${encRes(recvRes)}`)
            .setLabel('📋 Enter Amount →')
            .setStyle(ButtonStyle.Primary);

        return interaction.editReply({ embeds: [previewEmb], components: [new ActionRowBuilder().addComponents(confirmBtn)] });
    }
}

module.exports = {
    handleTax, handlePopulation, handleBalance, handleDonate, handleGift,
    handleTrade, handleEmpire, handleButton, handleModal, handleSelect
};
