/**
 * warfare_battle.js — Field Battle subsystem
 *
 * Handles the full field battle lifecycle:
 *   Initiation → Composition modal → GM naming → GM approval →
 *   Defender force commit → Battle resolution → Post-battle substat reward
 *
 * Imported by warfare.js which re-exports everything to interactionCreate.js.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const { ANCESTRIES, STAT_MAPPING, STAT_KEYS, TERRAINS, FORMATIONS } = require('../../data/constants');
const {
    getMod, getPlayerRank, resolveAtlasHQ, getNotificationChannel,
    isGM, calcMaintenance, sendToPlayer, calcMorale, ephemeralReply
} = require('../../utils/helpers');
const { generateBattleName, classifyBattle } = require('./battlename');
const {
    calcArmyPower, calcOffenseScore, compCounterBonus,
    getAgBonus, encodeName, decodeName,
    POLYSIA_KEYS, POLYSIA_CAV_BONUS
} = require('./warfare');

// ─── BATTLE INITIATION ──────────────────────────────────────────────────────

async function handleBattleInitiate(interaction) {
    const db = interaction.client.db;
    const targetId = interaction.options.getString('user');
    if (targetId === interaction.user.id)
        return interaction.editReply({ content: '⚠️ Cannot attack yourself.' });

    const atk = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
    const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
    if (!def) return interaction.editReply({ content: '⚠️ Target not found.' });

    const rank = getPlayerRank(atk);
    if (rank === 'SCION') return interaction.editReply({ content: '⚠️ Scions cannot declare battle.' });

    const atkHouse = ANCESTRIES[(atk.ancestry || '').toUpperCase()]?.house;
    const defHouse = ANCESTRIES[(def.ancestry || '').toUpperCase()]?.house;
    if (atkHouse && defHouse && atkHouse === defHouse && atkHouse !== 'INDEPENDENT' && atkHouse !== 'REMOVED')
        return interaction.editReply({ content: '⚠️ You cannot attack a member of the same Great House.' });

    const totalMilitia = (atk.mil_militia || 0) + (atk.mil_spearmen || 0) + (atk.mil_swordsman || 0) + (atk.mil_shield || 0);
    const modal = new ModalBuilder()
        .setCustomId(`warcomp_${atk.id}_${def.id}`)
        .setTitle('⚔️ Commit Forces');

    const fields = [
        { id: 'mil_militia', label: 'Infantry (Militia/Spearmen/Sword/Shield)', max: totalMilitia },
        { id: 'mil_cavalry', label: 'Cavalry', max: atk.mil_cavalry || 0 },
        { id: 'mil_ranged',  label: 'Ranged',  max: atk.mil_ranged  || 0 },
        { id: 'mil_siege',   label: 'Siege',   max: atk.mil_siege   || 0 },
        { id: 'mercs_temp',  label: 'Mercenaries', max: atk.mercs_temp || 0 },
    ];
    for (const f of fields) {
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(f.id)
                .setLabel(`${f.label} (max ${f.max})`)
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue('0')
                .setPlaceholder(`0-${f.max}`)
        ));
    }
    return await interaction.showModal(modal);
}

// ─── BATTLE COMPOSITION SUBMIT (modal) ──────────────────────────────────────

async function handleBattleCompositionSubmit(interaction, atkId, defId) {
    const db = interaction.client.db;
    try {
        const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
        const def = await db.get('SELECT * FROM users WHERE id=?', defId);
        if (!atk || !def) return ephemeralReply(interaction, '⚠️ Data not found.');

        const cols = ['mil_militia', 'mil_cavalry', 'mil_ranged', 'mil_siege', 'mercs_temp'];
        const counts = {};
        let totalFoodCost = 0;
        const totalMilitia = (atk.mil_militia || 0) + (atk.mil_spearmen || 0) + (atk.mil_swordsman || 0) + (atk.mil_shield || 0);

        for (const col of cols) {
            let val = 0;
            try { val = parseInt(interaction.fields.getTextInputValue(col)) || 0; } catch (_) {}
            if (val < 0) return ephemeralReply(interaction, '⚠️ Values must be 0 or positive.');
            const max = col === 'mil_militia' ? totalMilitia : (atk[col] || 0);
            if (val > max) return ephemeralReply(interaction, `⚠️ Cannot commit more ${col} than you own (max ${max}).`);
            counts[col] = val;
            totalFoodCost += val * 2;
        }

        if ((atk.food_surplus || 0) < totalFoodCost)
            return ephemeralReply(interaction, `⚠️ Insufficient supplies. Need **${totalFoodCost} 🥩**.`);

        await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', totalFoodCost, atk.id);

        const terrainKeys = Object.keys(TERRAINS);
        const terrainKey = terrainKeys[Math.floor(Math.random() * terrainKeys.length)];
        const terrain = TERRAINS[terrainKey];

        // 8-field format: militia-spear-sword-shield-cav-rng-sie-mercs-TERRAIN
        // Modal collects infantry as a combined pool; spear/sword/shield are zeroed here.
        const combined = counts['mil_militia'];
        const compStr = [
            combined, 0, 0, 0,
            counts['mil_cavalry'], counts['mil_ranged'],
            counts['mil_siege'],   counts['mercs_temp'],
            terrainKey
        ].join('-');

        const emb = new EmbedBuilder()
            .setTitle('⚔️ BATTLE REQUEST')
            .setColor(0xFF4400)
            .setImage(terrain?.img || null)
            .setDescription([
                `**Attacker:** <@${atk.id}> ${atk.ruler_name ? `— ${atk.ruler_name}` : ''}${atk.nation ? ` of ${atk.nation}` : ''}`,
                `**Target:** <@${def.id}> ${def.ruler_name ? `— ${def.ruler_name}` : ''}${def.nation ? ` of ${def.nation}` : ''}`,
                '',
                `🌍 **Terrain:** ${terrain?.name || terrainKey}`,
                '',
                `⚔️ Inf: ${counts.mil_militia} | 🐎 Cav: ${counts.mil_cavalry} | 🏹 Rng: ${counts.mil_ranged} | 🪨 Sie: ${counts.mil_siege} | 🗡️ Mercs: ${counts.mercs_temp}`,
                `🔥 Morale: ${calcMorale(atk)} | 🥩 Food: ${totalFoodCost}`,
            ].join('\n'));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`warapprove_battle_${atk.id}_${def.id}_${compStr}`).setLabel('✅ Approve Battle').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`warreject_battle_${atk.id}_${def.id}_${totalFoodCost}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
        );
        await resolveAtlasHQ(interaction.client, emb, [row]);
        return ephemeralReply(interaction, `⚔️ Battle request submitted. **${totalFoodCost} 🥩** supply spent. Awaiting GM approval.`);
    } catch (e) {
        console.error('[WARFARE] handleBattleCompositionSubmit error:', e.message);
        return ephemeralReply(interaction, '⚠️ Battle request failed. Please try again.');
    }
}

// ─── GM NAMES THE BATTLE (modal) ────────────────────────────────────────────

async function handleBattleNameSubmit(interaction, atkId, defId, compArgs) {
    const db = interaction.client.db;
    const nameInput = interaction.fields.getTextInputValue('battle_name')?.trim();
    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);

    const compStr = Array.isArray(compArgs) ? compArgs.join('_') : (compArgs || '');

    let battleName = nameInput;
    if (!battleName || battleName.length === 0) {
        let terrainKey = 'PLAINS';
        if (compStr && compStr.includes('-')) terrainKey = compStr.split('-')[8] || 'PLAINS';
        const battleType = classifyBattle({ hasTown: false, terrainType: terrainKey, isRaid: false });
        battleName = generateBattleName(battleType, {
            attackerNation: atk?.nation, defenderNation: def?.nation,
            attackerRulerName: atk?.ruler_name, isOutnumbered: false
        });
    }
    return handleBattleApprove(interaction, atkId, defId, compStr, battleName);
}

// ─── GM APPROVES BATTLE ──────────────────────────────────────────────────────

async function handleBattleApprove(interaction, atkId, defId, compArgs, battleName) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id)) return ephemeralReply(interaction, 'Access Denied.');

    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!atk || !def) return ephemeralReply(interaction, '⚠️ One or both players not found.');

    const compParts = typeof compArgs === 'string' ? compArgs.split('-') : [];
    let atkComp, terrainKey;
    if (compParts.length >= 9) {
        atkComp    = compParts.slice(0, 8).join('-');
        terrainKey = compParts[8] || 'PLAINS';
    } else {
        atkComp    = `${atk.mil_militia || 0}-0-0-0-${atk.mil_cavalry || 0}-${atk.mil_ranged || 0}-${atk.mil_siege || 0}-${atk.mercs_temp || 0}`;
        terrainKey = 'PLAINS';
    }
    const terrain = TERRAINS[terrainKey.toUpperCase()] || TERRAINS['PLAINS'];

    await interaction.update({ components: [], content: `⚔️ Battle approved. Awaiting <@${defId}> to commit forces...` });

    const displayName = battleName || 'Battle';
    await db.run('UPDATE users SET pending_battle=? WHERE id=?',
        `${atkId}|${atkComp}-${terrainKey}|${encodeName(displayName)}`, defId);

    const chan = await getNotificationChannel(interaction.client, def);
    const commitEmb = new EmbedBuilder()
        .setTitle(`⚔️ ${displayName}`)
        .setColor(0xFF0000)
        .setImage(terrain?.img || null)
        .setDescription([
            `<@${atkId}> ${atk.ruler_name ? `(${atk.ruler_name})` : ''}${atk.nation ? ` of **${atk.nation}**` : ''} is marching against you!`,
            `🌍 Terrain: **${terrain?.name || terrainKey}**`,
            '',
            `Choose which forces to commit to this battle.`,
            `You have: ⚔️ Inf: ${((def.mil_militia || 0) + (def.mil_spearmen || 0) + (def.mil_swordsman || 0) + (def.mil_shield || 0))} | 🐎 Cav: ${def.mil_cavalry || 0} | 🏹 Rng: ${def.mil_ranged || 0} | 🪨 Sie: ${def.mil_siege || 0} | 🗡️ Mercs: ${def.mercs_temp || 0}`,
        ].join('\n'));
    const commitRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wardefcommit_${atkId}_${defId}_${atkComp}-${terrainKey}`).setLabel('⚔️ Commit Forces').setStyle(ButtonStyle.Danger)
    );

    if (chan) {
        try { await chan.send({ content: `<@${defId}>`, embeds: [commitEmb], components: [commitRow] }); } catch (_) {}
    } else {
        try {
            const u = await interaction.client.users.fetch(defId);
            if (u) await u.send({ embeds: [commitEmb], components: [commitRow] });
        } catch (_) {}
    }
}

// ─── DEFENDER CLICKS "COMMIT FORCES" ────────────────────────────────────────

async function handleDefenderCommit(interaction, atkId, defId, atkComp) {
    const db = interaction.client.db;
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!def) return ephemeralReply(interaction, '⚠️ Data not found.');
    if (interaction.user.id !== defId) return ephemeralReply(interaction, '⚠️ Only the defender may commit forces to this battle.');

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`wardefform_${atkId}_${defId}_${atkComp}`)
        .setPlaceholder('Choose your formation...');
    for (const [key, f] of Object.entries(FORMATIONS)) {
        menu.addOptions({ label: `${f.name} (${f.type})`, value: key, description: f.bonus });
    }
    const emb = new EmbedBuilder().setTitle('🛡️ Choose Formation').setColor(0xFFD700)
        .setDescription(Object.entries(FORMATIONS).map(([, f]) => `**${f.name}**: ${f.bonus}\n\`\`\`\n${f.preview}\n\`\`\``).join('\n'));
    return interaction.reply({ embeds: [emb], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
}

// ─── DEFENDER PICKS FORMATION ────────────────────────────────────────────────

async function handleDefenderFormationPick(interaction, atkId, defId, atkComp, formationKey) {
    const db = interaction.client.db;
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!def || interaction.user.id !== defId) return ephemeralReply(interaction, '⚠️ Access denied.');

    const modal = new ModalBuilder()
        .setCustomId(`wardefmodal_${atkId}_${defId}_${atkComp}_${formationKey}`)
        .setTitle('🛡️ Commit Forces — %');
    const cols   = ['mil_militia', 'mil_spearmen', 'mil_swordsman', 'mil_shield', 'mil_cavalry', 'mil_ranged', 'mil_siege', 'mercs_temp'];
    const labels = ['Militiamen', 'Spearmen', 'Swordsman', 'Shield Inf.', 'Cavalry', 'Ranged', 'Siege', 'Mercenaries'];
    let added = 0;
    for (let i = 0; i < cols.length; i++) {
        const max = def[cols[i]] || 0;
        if (max === 0 && cols[i] !== 'mercs_temp') continue;
        if (added >= 5) break;
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(cols[i]).setLabel(`${labels[i]} (${max})`).setStyle(TextInputStyle.Short).setRequired(false).setValue('0').setPlaceholder('0-100%')
        ));
        added++;
    }
    return await interaction.showModal(modal);
}

// ─── BATTLE RESOLVE (defender submits percentage modal) ──────────────────────

async function handleBattleResolve(interaction, atkId, defId, atkCompStr, formationKey) {
    const db = interaction.client.db;
    const compParts  = atkCompStr.split('-');
    const terrainKey = compParts[compParts.length - 1] || 'PLAINS';
    const atkCompArr = compParts.slice(0, compParts.length - 1).map(Number);

    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!atk || !def) return ephemeralReply(interaction, '⚠️ Data not found.');

    let battleName = 'Battle';
    if (def.pending_battle) {
        const parts = def.pending_battle.split('|');
        if (parts.length >= 3) battleName = decodeName(parts[2]);
    }

    const cols = ['mil_militia', 'mil_spearmen', 'mil_swordsman', 'mil_shield', 'mil_cavalry', 'mil_ranged', 'mil_siege', 'mercs_temp'];
    const defCompRaw = {};
    let defTotal = 0;
    for (const f of cols) {
        let val = 0;
        try { val = parseInt(interaction.fields.getTextInputValue(f)) || 0; } catch (_) {}
        if (val < 0) return ephemeralReply(interaction, '⚠️ Values must be 0 or positive.');
        const max = def[f] || 0;
        if (val > max) return ephemeralReply(interaction, `⚠️ Cannot commit more ${f.replace('mil_', '')} than you own (max ${max}).`);
        defCompRaw[f] = val;
        if (f !== 'mil_siege') defTotal += val;
    }

    const defFood = defTotal * 2;
    if ((def.food_surplus || 0) < defFood)
        return ephemeralReply(interaction, `⚠️ Insufficient food. Need **${defFood} 🥩**.`);
    await db.run('UPDATE users SET food_surplus=MAX(0,food_surplus-?) WHERE id=?', defFood, def.id);

    // Build power objects
    const defComp = {
        inf:   defCompRaw.mil_militia + defCompRaw.mil_spearmen + defCompRaw.mil_swordsman + defCompRaw.mil_shield,
        cav:   defCompRaw.mil_cavalry,
        rng:   defCompRaw.mil_ranged,
        sie:   defCompRaw.mil_siege,
        mercs: defCompRaw.mercs_temp
    };
    const atkInf      = atkCompArr[0] + atkCompArr[1] + atkCompArr[2] + atkCompArr[3];
    const atkForPower = { ...atk, mil_infantry: atkInf, mil_cavalry: atkCompArr[4], mil_ranged: atkCompArr[5], mil_siege: atkCompArr[6], mercs_temp: atkCompArr[7] };
    const defForPower = { ...def, mil_infantry: defComp.inf, mil_cavalry: defComp.cav, mil_ranged: defComp.rng, mil_siege: defComp.sie, mercs_temp: defComp.mercs };

    const atkRoll = Math.floor(Math.random() * 20) + 1;
    const defRoll = Math.floor(Math.random() * 20) + 1;
    const agBonusAtk = await getAgBonus(db, atkId, atk);
    const agBonusDef = await getAgBonus(db, defId, def);
    const atkOff     = await calcOffenseScore(db, atkId);
    const menMod     = getMod(atk.attr_men || 10);
    const hasCav     = POLYSIA_KEYS.includes((atk.ancestry || '').toUpperCase()) && (atkForPower.mil_cavalry || 0) > 0;
    const polyB      = hasCav ? POLYSIA_CAV_BONUS : 0;
    const counter    = compCounterBonus(atkForPower, defForPower);

    const atkFormObj    = FORMATIONS[formationKey] || {};
    const atkFormMod    = atkFormObj.atkMod || 1.0;
    const atkFormDefMod = atkFormObj.defMod || 1.0;

    const atkPower = (calcArmyPower(atkForPower, 'field', terrainKey) * atkFormMod) + atkOff * 5 + menMod * 2 + polyB + counter + atkRoll + agBonusAtk;
    const defPower = (calcArmyPower(defForPower, 'field', terrainKey) * atkFormDefMod * 1.2) + (await calcOffenseScore(db, defId)) * 5 + defRoll + agBonusDef;

    const winnerId     = atkPower > defPower ? atkId : defId;
    const isAtkWin     = winnerId === atkId;
    const lossFactor   = 0.70 + Math.random() * 0.15;

    // Casualties
    const atkl = { militia: Math.max(0, Math.floor(atkCompArr[0] * lossFactor)), spearmen: Math.max(0, Math.floor(atkCompArr[1] * lossFactor)), swordsman: Math.max(0, Math.floor(atkCompArr[2] * lossFactor)), shield: Math.max(0, Math.floor(atkCompArr[3] * lossFactor)), cavalry: Math.max(0, Math.floor(atkCompArr[4] * lossFactor)), ranged: Math.max(0, Math.floor(atkCompArr[5] * lossFactor)), siege: Math.max(0, Math.floor(atkCompArr[6] * lossFactor)), mercs: Math.max(0, Math.floor(atkCompArr[7] * lossFactor)) };
    const defl = { militia: Math.max(0, Math.floor(defCompRaw.mil_militia * lossFactor)), spearmen: Math.max(0, Math.floor(defCompRaw.mil_spearmen * lossFactor)), swordsman: Math.max(0, Math.floor(defCompRaw.mil_swordsman * lossFactor)), shield: Math.max(0, Math.floor(defCompRaw.mil_shield * lossFactor)), cavalry: Math.max(0, Math.floor(defCompRaw.mil_cavalry * lossFactor)), ranged: Math.max(0, Math.floor(defCompRaw.mil_ranged * lossFactor)), siege: Math.max(0, Math.floor(defCompRaw.mil_siege * lossFactor)), mercs: Math.max(0, Math.floor(defCompRaw.mercs_temp * lossFactor)) };

    await db.run('UPDATE users SET mil_militia=MAX(0,mil_militia-?), mil_spearmen=MAX(0,mil_spearmen-?), mil_swordsman=MAX(0,mil_swordsman-?), mil_shield=MAX(0,mil_shield-?), mil_cavalry=MAX(0,mil_cavalry-?), mil_ranged=MAX(0,mil_ranged-?), mil_siege=MAX(0,mil_siege-?), mercs_temp=MAX(0,mercs_temp-?) WHERE id=?',
        atkl.militia, atkl.spearmen, atkl.swordsman, atkl.shield, atkl.cavalry, atkl.ranged, atkl.siege, atkl.mercs, atkId);
    await db.run('UPDATE users SET mil_militia=MAX(0,mil_militia-?), mil_spearmen=MAX(0,mil_spearmen-?), mil_swordsman=MAX(0,mil_swordsman-?), mil_shield=MAX(0,mil_shield-?), mil_cavalry=MAX(0,mil_cavalry-?), mil_ranged=MAX(0,mil_ranged-?), mil_siege=MAX(0,mil_siege-?), mercs_temp=MAX(0,mercs_temp-?) WHERE id=?',
        defl.militia, defl.spearmen, defl.swordsman, defl.shield, defl.cavalry, defl.ranged, defl.siege, defl.mercs, defId);

    // Prestige/stability
    if (isAtkWin) {
        await db.run('UPDATE users SET rate_prest=MAX(-10,rate_prest-2), rate_stab=MAX(-10,rate_stab-1) WHERE id=?', defId);
        await db.run('UPDATE users SET rate_prest=MIN(10,rate_prest+1) WHERE id=?', atkId);
    } else {
        await db.run('UPDATE users SET rate_prest=MAX(-10,rate_prest-2), rate_stab=MAX(-10,rate_stab-1) WHERE id=?', atkId);
        await db.run('UPDATE users SET rate_prest=MIN(10,rate_prest+1) WHERE id=?', defId);
    }

    // Recalc maintenance after losses
    const atkRow = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const defRow = await db.get('SELECT * FROM users WHERE id=?', defId);
    await db.run('UPDATE users SET mil_maintenance_cost=? WHERE id=?', calcMaintenance(atkRow), atkId);
    await db.run('UPDATE users SET mil_maintenance_cost=? WHERE id=?', calcMaintenance(defRow), defId);

    await db.run('INSERT INTO gm_events (user_id, gm_id, event_type, severity, effect_snapshot, created_at) VALUES (?,?,?,?,?,?)',
        winnerId, interaction.user?.id || 'system', 'field_battle', 1,
        JSON.stringify({ atk: atkId, def: defId, winner: winnerId, atkComp: atkCompStr, defComp: `${defCompRaw.mil_militia}-${defCompRaw.mil_spearmen}-${defCompRaw.mil_swordsman}-${defCompRaw.mil_shield}-${defCompRaw.mil_cavalry}-${defCompRaw.mil_ranged}-${defCompRaw.mil_siege}-${defCompRaw.mercs_temp}` }),
        Date.now());
    await db.run('UPDATE users SET pending_battle=NULL WHERE id=?', defId);

    await ephemeralReply(interaction, '⚔️ Forces committed! The battle is joined.');

    const terrain          = TERRAINS[terrainKey.toUpperCase()] || TERRAINS['PLAINS'];
    const atkInfLost       = atkl.militia + atkl.spearmen + atkl.swordsman + atkl.shield;
    const defInfLost       = defl.militia + defl.spearmen + defl.swordsman + defl.shield;
    const loserPower       = isAtkWin ? defPower : atkPower;
    const winnerPower      = isAtkWin ? atkPower : defPower;
    const isOutnumbered    = loserPower > 0 && winnerPower / loserPower >= 2.0;

    // Send result embeds to both players
    for (const uid of [atkId, defId]) {
        const isWin   = uid === winnerId;
        const userObj = uid === atkId ? atk : def;
        const chan     = await getNotificationChannel(interaction.client, userObj);
        const emb = new EmbedBuilder()
            .setTitle(`${isWin ? '🏆' : '💀'} ${battleName}`)
            .setColor(isWin ? 0x00FF88 : 0xFF0000)
            .setImage(terrain?.img || null)
            .setDescription([
                `**${battleName}** (${terrain?.name || terrainKey})`,
                `Atk: <@${atkId}> vs Def: <@${defId}>`,
                '',
                `**Power:** ${atkPower} vs ${defPower}`,
                isOutnumbered ? '⚠️ **OUTNUMBERED!** A crushed defeat.' : '',
                '',
                `**Attacker Losses:** ⚔️ Inf: ${atkInfLost} | 🐎 Cav: ${atkl.cavalry} | 🏹 Rng: ${atkl.ranged}`,
                `**Defender Losses:** ⚔️ Inf: ${defInfLost} | 🐎 Cav: ${defl.cavalry} | 🏹 Rng: ${defl.ranged}`,
                '',
                isWin ? '+1 Prestige' : '-2 Prestige, -1 Stability'
            ].filter(Boolean).join('\n'));
        let sent = false;
        if (chan) { try { await chan.send({ content: `<@${uid}>`, embeds: [emb] }); sent = true; } catch (_) {} }
        if (!sent) { try { const u = await interaction.client.users.fetch(uid); if (u) await u.send({ embeds: [emb] }); } catch (_) {} }
    }

    // 20% chance of post-battle substat reward for winner
    if (Math.random() < 0.20) {
        const chan = await getNotificationChannel(interaction.client, isAtkWin ? atk : def);
        if (chan) {
            const emb = new EmbedBuilder().setTitle('✨ MOMENT OF BRILLIANCE').setColor(0xFFD700)
                .setDescription('Choose a substat to improve (+1):');
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`warbattle_ss_str_${winnerId}`).setLabel('💪 STR').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`warbattle_ss_men_${winnerId}`).setLabel('🔥 MEN').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`warbattle_ss_mot_${winnerId}`).setLabel('⚡ MOT').setStyle(ButtonStyle.Primary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`warbattle_ss_int_${winnerId}`).setLabel('🧠 INT').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`warbattle_ss_wis_${winnerId}`).setLabel('🕯️ WIS').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`warbattle_ss_cha_${winnerId}`).setLabel('🎭 CHA').setStyle(ButtonStyle.Primary)
            );
            try { await chan.send({ content: `<@${winnerId}>`, embeds: [emb], components: [row1, row2] }); } catch (_) {}
        }
    }
}

// ─── BATTLE SUBSTAT REWARD ───────────────────────────────────────────────────

async function handleBattleSubstat(interaction, statKey, winnerId) {
    const db = interaction.client.db;
    if (interaction.user.id !== winnerId) return ephemeralReply(interaction, '⚠️ Only the battle winner may choose.');
    const attrKey = STAT_KEYS[statKey] || `attr_${statKey}`;
    await db.run(`UPDATE users SET ${attrKey}=MIN(20,${attrKey}+1) WHERE id=?`, winnerId);
    await interaction.update({ components: [], content: interaction.message.content + `\n\n✨ ${STAT_MAPPING[statKey]?.name || statKey.toUpperCase()} improved!` });
}

module.exports = {
    handleBattleInitiate, handleBattleCompositionSubmit, handleBattleNameSubmit,
    handleBattleApprove,  handleDefenderCommit, handleDefenderFormationPick,
    handleBattleResolve,  handleBattleSubstat
};
