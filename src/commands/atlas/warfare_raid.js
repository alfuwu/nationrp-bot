/**
 * warfare_raid.js — Raid subsystem
 *
 * Handles the two-phase raid lifecycle:
 *   Initiation → GM approval → Phase 1 combat → Player withdraw/press decision →
 *   Phase 2 resolution → Loot & notification
 *
 * Imported by warfare.js which re-exports everything to interactionCreate.js.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { ANCESTRIES } = require('../../data/constants');
const {
    getMod, getPlayerRank, resolveAtlasHQ, getNotificationChannel,
    isGM, calcMaintenance, ephemeralReply, sendToPlayer
} = require('../../utils/helpers');
const {
    calcArmyPower, calcOffenseScore, getAgBonus,
    encodeName, decodeName
} = require('./warfare');

// ─── RAID INITIATION ─────────────────────────────────────────────────────────

async function handleRaidInitiate(interaction) {
    const db = interaction.client.db;
    const targetId = interaction.options.getString('user');
    const townName = interaction.options.getString('town') || null;
    if (targetId === interaction.user.id)
        return interaction.editReply({ content: '⚠️ Cannot raid yourself.' });

    const atk = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
    const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
    if (!def) return interaction.editReply({ content: '⚠️ Target not found.' });

    if (townName) {
        const t = await db.get('SELECT * FROM towns WHERE user_id=? AND name=?', targetId, townName);
        if (!t) return interaction.editReply({ content: '⚠️ Target town not found.' });
    }

    const rank = getPlayerRank(atk);
    if (rank === 'SCION') return interaction.editReply({ content: '⚠️ Scions cannot raid.' });

    const atkHouse = ANCESTRIES[(atk.ancestry || '').toUpperCase()]?.house;
    const defHouse = ANCESTRIES[(def.ancestry || '').toUpperCase()]?.house;
    if (atkHouse && defHouse && atkHouse === defHouse && atkHouse !== 'INDEPENDENT' && atkHouse !== 'REMOVED')
        return interaction.editReply({ content: '⚠️ You cannot raid a member of the same Great House.' });

    const modal = new ModalBuilder()
        .setCustomId(`warraid_${atk.id}_${def.id}${townName ? '_' + encodeName(townName) : ''}`)
        .setTitle('🗡️ Commit Raid Forces');

    const fields = [
        { id: 'inf',   label: 'Infantry',                  max: atk.mil_infantry || 0 },
        { id: 'cav',   label: 'Cavalry (recommended)',      max: atk.mil_cavalry  || 0 },
        { id: 'rng',   label: 'Ranged (recommended)',       max: atk.mil_ranged   || 0 },
        { id: 'sie',   label: 'Siege (slows withdrawal!)',  max: atk.mil_siege    || 0 },
        { id: 'mercs', label: 'Mercenaries',                max: atk.mercs_temp   || 0 },
    ];
    for (const f of fields) {
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(f.id).setLabel(`${f.label} (max ${f.max})`).setStyle(TextInputStyle.Short).setRequired(false).setValue('0').setPlaceholder(`0-${f.max}`)
        ));
    }
    return await interaction.showModal(modal);
}

// ─── RAID COMPOSITION SUBMIT (modal → GM approval request) ───────────────────

async function handleRaidCompositionSubmit(interaction, atkId, defId, townNameEnc) {
    const db = interaction.client.db;
    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!atk || !def) return ephemeralReply(interaction, '⚠️ Data not found.');

    const townName = townNameEnc ? decodeName(townNameEnc) : null;

    // Infantry is submitted as a combined pool from the modal (ids: inf/cav/rng/sie/mercs)
    const modalFields = ['inf', 'cav', 'rng', 'sie', 'mercs'];
    const atkCols     = ['mil_infantry', 'mil_cavalry', 'mil_ranged', 'mil_siege', 'mercs_temp'];
    const counts = {};
    for (let i = 0; i < modalFields.length; i++) {
        let val = 0;
        try { val = parseInt(interaction.fields.getTextInputValue(modalFields[i])) || 0; } catch (_) {}
        if (val < 0) return ephemeralReply(interaction, '⚠️ Values must be 0 or positive.');
        const max = atk[atkCols[i]] || 0;
        if (val > max) return ephemeralReply(interaction, `⚠️ Cannot commit more than you own (max ${max}).`);
        counts[modalFields[i]] = val;
    }

    const totalCost = Object.values(counts).reduce((s, v) => s + v, 0) * 2;
    if ((atk.food_surplus || 0) < totalCost)
        return ephemeralReply(interaction, `⚠️ Insufficient supplies. Need **${totalCost} 🥩**.`);

    await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', totalCost, atk.id);

    // Encode force counts into a compact string for the GM approve button
    const compStr = `${counts.inf}_${counts.cav}_${counts.rng}_${counts.sie}_${counts.mercs}`;

    const emb = new EmbedBuilder()
        .setTitle('🗡️ RAID REQUEST')
        .setColor(0xFF8800)
        .setDescription([
            `**Raider:** <@${atk.id}> ${atk.ruler_name ? `— ${atk.ruler_name}` : ''}${atk.nation ? ` of ${atk.nation}` : ''}`,
            `**Target:** <@${def.id}> ${def.ruler_name ? `— ${def.ruler_name}` : ''}${townName ? ` at **${townName}**` : ''}`,
            '',
            `⚔️ Inf: ${counts.inf} | 🐎 Cav: ${counts.cav} | 🏹 Rng: ${counts.rng} | 🪨 Sie: ${counts.sie} | 🗡️ Mercs: ${counts.mercs}`,
            `🥩 Supply cost: ${totalCost}`,
        ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`warraid_approve_${atkId}_${defId}_${compStr}${townNameEnc ? '_' + townNameEnc : ''}`).setLabel('✅ Approve Raid').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`warraid_abort_${atkId}`).setLabel('❌ Abort').setStyle(ButtonStyle.Danger)
    );
    await resolveAtlasHQ(interaction.client, emb, [row]);
    return ephemeralReply(interaction, `🗡️ Raid request submitted. **${totalCost} 🥩** supply spent. Awaiting GM approval.`);
}

// ─── GM APPROVES RAID → PHASE 1 COMBAT ──────────────────────────────────────

async function handleRaidApprove(interaction, atkId, defId, compArgs, townNameEnc) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id)) return ephemeralReply(interaction, 'Access Denied.');

    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!atk || !def) return ephemeralReply(interaction, '⚠️ Data not found.');

    // compArgs is an array of 5 elements [inf, cav, rng, sie, mercs]
    const [inf, cav, rng, sie, mercs] = (compArgs || []).map(Number);
    const townName = townNameEnc && townNameEnc !== 'none' ? decodeName(townNameEnc) : null;

    const terrainKey = townName
        ? (await db.get('SELECT terrain_type FROM towns WHERE user_id=? AND name=?', defId, townName))?.terrain_type || 'PLAINS'
        : 'PLAINS';

    const atkRoll   = Math.floor(Math.random() * 20) + 1;
    const defRoll   = Math.floor(Math.random() * 20) + 1;
    const agAtk     = await getAgBonus(db, atkId, atk);
    const agDef     = await getAgBonus(db, defId, def);
    const atkForPow = { ...atk, mil_infantry: inf, mil_cavalry: cav, mil_ranged: rng, mil_siege: sie, mercs_temp: mercs };

    // Raiders get a 1.5× field advantage — represents surprise and mobility
    const atkPower = calcArmyPower(atkForPow, 'field', terrainKey) * 1.5 + (await calcOffenseScore(db, atkId)) * 5 + getMod(atk.attr_men || 10) * 2 + atkRoll + agAtk;
    const defPower = calcArmyPower(def,        'field', terrainKey)       + defRoll + agDef;

    const p1Wins      = atkPower > defPower;
    const powerMargin = Math.max(0.1, atkPower / Math.max(1, defPower)).toFixed(2);
    const p1Loss      = p1Wins ? (0.90 + Math.random() * 0.10) : (0.75 + Math.random() * 0.15);

    const p1Inf   = Math.max(0, Math.floor(inf   * p1Loss));
    const p1Cav   = Math.max(0, Math.floor(cav   * p1Loss));
    const p1Rng   = Math.max(0, Math.floor(rng   * p1Loss));
    const p1Sie   = Math.max(0, Math.floor(sie   * p1Loss));
    const p1Mercs = Math.max(0, Math.floor(mercs * p1Loss));

    // Encode all phase-1 data into the button customIds (compact string handoff)
    const battleData = `${atkId}_${defId}_${inf}_${cav}_${rng}_${sie}_${mercs}_${terrainKey}_${p1Wins ? '1' : '0'}_${powerMargin}_${p1Inf}_${p1Cav}_${p1Rng}_${p1Sie}_${p1Mercs}_${townNameEnc || 'none'}`;

    await interaction.update({ components: [], content: `🗡️ Raid approved by GM. Phase 1 in progress...` });

    const emb = new EmbedBuilder()
        .setTitle('🗡️ RAID PHASE 1 COMPLETE')
        .setColor(p1Wins ? 0x00FF88 : 0xFFAA00)
        .setDescription([
            `**Target:** <@${def.id}> ${townName ? 'at ' + townName : ''}`,
            '',
            `⚔️ Phase 1 Result: **${p1Wins ? 'Breached Defenses' : 'Met Resistance'}**`,
            `Power Margin: ×${powerMargin}`,
            '',
            `Surviving Forces:`,
            `⚔️ Inf: ${p1Inf}/${inf} | 🐎 Cav: ${p1Cav}/${cav} | 🏹 Rng: ${p1Rng}/${rng}`,
            `🪨 Sie: ${p1Sie}/${sie} | 🗡️ Mercs: ${p1Mercs}/${mercs}`,
            '',
            `Do you want to withdraw now with your loot and surviving forces, or press the attack?`
        ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`raidwithdraw_now_${battleData}`).setLabel('🏃 Withdraw Now').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`raidwithdraw_press_${battleData}`).setLabel('⚔️ Press the Attack').setStyle(ButtonStyle.Danger)
    );
    await sendToPlayer(interaction.client, interaction, atkId, { embeds: [emb], components: [row] });
}

// ─── PLAYER WITHDRAW / PRESS THE ATTACK ──────────────────────────────────────

async function handleRaidWithdraw(interaction, battleData, isNow) {
    const db    = interaction.client.db;
    const parts = battleData.split('_');

    const atkId = parts[0], defId = parts[1];
    const rInf  = parseInt(parts[2]),  rCav   = parseInt(parts[3]);
    const rRng  = parseInt(parts[4]),  rSie   = parseInt(parts[5]), rMercs = parseInt(parts[6]);
    const terrainKey  = parts[7];
    const raidWonP1   = parts[8] === '1';
    const powerMargin = parseFloat(parts[9]) || 1;
    const p1Inf  = parseInt(parts[10]), p1Cav   = parseInt(parts[11]);
    const p1Rng  = parseInt(parts[12]), p1Sie   = parseInt(parts[13]), p1Mercs = parseInt(parts[14]);
    const townNameEnc = parts.length > 15 ? parts.slice(15).join('_') : 'none';
    const townName    = townNameEnc !== 'none' ? decodeName(townNameEnc) : null;

    const atk = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def = await db.get('SELECT * FROM users WHERE id=?', defId);
    if (!atk || !def || interaction.user.id !== atkId)
        return ephemeralReply(interaction, '⚠️ Only the raider may choose.');

    let finalInf = p1Inf, finalCav = p1Cav, finalRng = p1Rng, finalSie = p1Sie, finalMercs = p1Mercs;
    let defLosses = 0;
    let loot = 0;

    if (isNow) {
        // Withdraw: light additional casualties (10%), collect proportional loot
        finalInf   = Math.max(0, Math.floor(rInf   * 0.90));
        finalCav   = Math.max(0, Math.floor(rCav   * 0.90));
        finalRng   = Math.max(0, Math.floor(rRng   * 0.90));
        finalSie   = Math.max(0, Math.floor(rSie   * 0.90));
        finalMercs = Math.max(0, Math.floor(rMercs * 0.90));
        loot = Math.min(
            Math.floor((def.wealth || 0) * 0.10),
            Math.floor((def.wealth || 0) * 0.05 * powerMargin)
        );
    } else {
        // Press the attack: Phase 2 — defender rallies with a 1.3× buff
        const atkRoll2  = Math.floor(Math.random() * 20) + 1;
        const defRoll2  = Math.floor(Math.random() * 20) + 1;
        const atkForP2  = { ...atk, mil_infantry: p1Inf, mil_cavalry: p1Cav, mil_ranged: p1Rng, mil_siege: p1Sie, mercs_temp: p1Mercs };
        const atkP2     = calcArmyPower(atkForP2, 'field', terrainKey) + (await calcOffenseScore(db, atkId)) * 5 + getMod(atk.attr_men || 10) * 2 + atkRoll2 + (await getAgBonus(db, atkId, atk));
        const defP2     = calcArmyPower(def, 'field', terrainKey) * 1.3 + (await calcOffenseScore(db, defId)) * 5 + defRoll2 + (await getAgBonus(db, defId, def));
        const p2Wins    = atkP2 > defP2;
        const p2Loss    = p2Wins ? (0.85 + Math.random() * 0.10) : (0.50 + Math.random() * 0.20);

        finalInf   = Math.max(0, Math.floor(p1Inf   * p2Loss));
        finalCav   = Math.max(0, Math.floor(p1Cav   * p2Loss));
        finalRng   = Math.max(0, Math.floor(p1Rng   * p2Loss));
        finalSie   = Math.max(0, Math.floor(p1Sie   * p2Loss));
        finalMercs = Math.max(0, Math.floor(p1Mercs * p2Loss));
        defLosses  = Math.max(0, Math.floor((def.pop_commoners || 100) * 0.05));

        if (p2Wins) {
            const pm = atkP2 / Math.max(1, defP2);
            loot = Math.min(
                Math.floor((def.wealth || 0) * 0.10),
                Math.floor((def.wealth || 0) * 0.05 * pm)
            );
        }
    }

    // Apply casualties
    const atkLost = {
        inf:   Math.max(0, rInf   - finalInf),
        cav:   Math.max(0, rCav   - finalCav),
        rng:   Math.max(0, rRng   - finalRng),
        sie:   Math.max(0, rSie   - finalSie),
        mercs: Math.max(0, rMercs - finalMercs)
    };
    await db.run(
        'UPDATE users SET mil_infantry=MAX(0,mil_infantry-?), mil_cavalry=MAX(0,mil_cavalry-?), mil_ranged=MAX(0,mil_ranged-?), mil_siege=MAX(0,mil_siege-?), mercs_temp=MAX(0,mercs_temp-?) WHERE id=?',
        atkLost.inf, atkLost.cav, atkLost.rng, atkLost.sie, atkLost.mercs, atkId
    );

    // Apply loot transfer
    if (loot > 0) {
        await db.run('UPDATE users SET wealth=MAX(0,wealth-?) WHERE id=?', loot, defId);
        await db.run('UPDATE users SET wealth=COALESCE(wealth,0)+? WHERE id=?', loot, atkId);
    }
    if (defLosses > 0)
        await db.run('UPDATE users SET pop_commoners=MAX(10,pop_commoners-?) WHERE id=?', defLosses, defId);

    // Recalc maintenance
    const atkRow = await db.get('SELECT * FROM users WHERE id=?', atkId);
    await db.run('UPDATE users SET mil_maintenance_cost=? WHERE id=?', calcMaintenance(atkRow), atkId);

    // Emit result to raider
    const phase  = isNow ? 'Withdrew' : 'Pressed Attack';
    const atkEmb = new EmbedBuilder()
        .setTitle(loot > 0 ? '🗡️ RAID COMPLETE — LOOT SECURED' : '🗡️ RAID WITHDRAWN')
        .setColor(loot > 0 ? 0x00FF88 : 0xAAAAAA)
        .setDescription([
            `**Action:** ${phase}`,
            '',
            `**Your Casualties:** ⚔️ Inf: ${atkLost.inf} | 🐎 Cav: ${atkLost.cav} | 🏹 Rng: ${atkLost.rng} | 🪨 Sie: ${atkLost.sie} | 🗡️ Mercs: ${atkLost.mercs}`,
            '',
            loot > 0 ? `💰 **Loot:** ${loot} ⚖️ plundered from <@${defId}>` : '💀 No loot secured.',
            defLosses > 0 ? `☠️ Defender casualties: ${defLosses} commoners` : '',
        ].filter(Boolean).join('\n'));
    await interaction.update({ embeds: [atkEmb], components: [] });

    // Notify defender
    const defEmb = new EmbedBuilder()
        .setTitle('🚨 YOUR TERRITORY WAS RAIDED')
        .setColor(0xFF4400)
        .setDescription([
            `<@${atkId}> raided your territory${townName ? ` at **${townName}**` : ''}!`,
            loot > 0 ? `💰 They plundered **${loot} ⚖️** from your treasury.` : '',
            defLosses > 0 ? `☠️ ${defLosses} commoners were lost.` : '',
        ].filter(Boolean).join('\n'));
    await sendToPlayer(interaction.client, interaction, defId, { embeds: [defEmb] });
}

module.exports = {
    handleRaidInitiate, handleRaidCompositionSubmit, handleRaidApprove, handleRaidWithdraw
};
