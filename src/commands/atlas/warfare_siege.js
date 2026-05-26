/**
 * warfare_siege.js — Siege subsystem
 *
 * Handles the full siege lifecycle:
 *   Initiation → GM approval (warconfirm) → Resolution → Building destruction
 *
 * Imported by warfare.js which re-exports everything to interactionCreate.js.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { ANCESTRIES, BUILDINGS, TERRAINS } = require('../../data/constants');
const {
    getMod, getPlayerRank, resolveAtlasHQ, getNotificationChannel,
    isGM, calcMaintenance, calcMorale, ephemeralReply
} = require('../../utils/helpers');
const { generateBattleName } = require('./battlename');
const {
    calcArmyPower, calcDefenseScore, calcOffenseScore, getAgBonus,
    TERRAIN_DEF, POLYSIA_KEYS, POLYSIA_CAV_BONUS, STYX_HOUSES, STYX_FORT_BONUS
} = require('./warfare');

// ─── SIEGE FOOD HELPERS ──────────────────────────────────────────────────────

function siegeFoodCostAtk(user) {
    const total = (user.mil_infantry || 0) + (user.mil_cavalry || 0) + (user.mil_ranged || 0) + (user.mil_siege || 0) + (user.mercs_temp || 0);
    return total * 5;
}

function siegeFoodCostDef(user) {
    const total = (user.mil_infantry || 0) + (user.mil_cavalry || 0) + (user.mil_ranged || 0) + (user.mil_siege || 0);
    return total * 2;
}

// ─── SIEGE INITIATION ────────────────────────────────────────────────────────

async function handleSiegeInitiate(interaction) {
    const db = interaction.client.db;
    const targetId = interaction.options.getString('user');
    const townName = interaction.options.getString('target_town');
    if (targetId === interaction.user.id)
        return interaction.editReply({ content: '⚠️ Cannot siege your own settlement.' });

    const atk = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
    const rank = getPlayerRank(atk);
    if (rank !== 'SOVEREIGN')
        return interaction.editReply({ content: '⚠️ Only Sovereigns may lay siege.' });

    const def  = await db.get('SELECT * FROM users WHERE id=?', targetId);
    if (!def) return interaction.editReply({ content: '⚠️ Target not found.' });
    const town = await db.get('SELECT * FROM towns WHERE user_id=? AND name=?', targetId, townName);
    if (!town) return interaction.editReply({ content: '⚠️ Target town not found.' });

    const atkFood = siegeFoodCostAtk(atk);
    if ((atk.food_surplus || 0) < atkFood)
        return interaction.editReply({ content: `⚠️ Need **${atkFood} 🥩** to lay siege.` });
    await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', atkFood, atk.id);

    const defFood     = siegeFoodCostDef(def);
    const defSupplied = (def.food_surplus || 0) >= defFood;
    if (defSupplied)
        await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', defFood, def.id);

    const siegeName = generateBattleName('SIEGE', {
        townName: town.name,
        attackerNation: atk.nation, defenderNation: def.nation,
        attackerRulerName: atk.ruler_name
    });

    const emb = new EmbedBuilder()
        .setTitle(`🏰 ${siegeName}`)
        .setColor(0xFF4400)
        .setDescription([
            `**Attacker:** <@${atk.id}> | **Target:** <@${def.id}> — **${town.name}**`,
            '',
            `⚔️ Inf: ${atk.mil_infantry || 0} | 🐎 Cav: ${atk.mil_cavalry || 0} | 🏹 Rng: ${atk.mil_ranged || 0} | 🪨 Sie: ${atk.mil_siege || 0}`,
            `Morale: ${calcMorale(atk)} | Food: ${atkFood} 🥩`,
            !defSupplied ? '⚠️ **DEFENDER UNDERSUPPLIED** — power halved.' : '',
        ].filter(Boolean).join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`warconfirm_s_${atk.id}_${def.id}_${town.id}`).setLabel('✅ Confirm Siege').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`warabort_s_${atk.id}`).setLabel('❌ Abort').setStyle(ButtonStyle.Danger)
    );
    await resolveAtlasHQ(interaction.client, emb, [row]);
    return interaction.editReply({ content: `🏰 Siege request submitted. **${atkFood} 🥩** supply spent. Awaiting GM approval.` });
}

// ─── GM CONFIRMS SIEGE ───────────────────────────────────────────────────────

async function handleSiegeConfirm(interaction, atkId, defId, townId) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id)) return ephemeralReply(interaction, 'Access Denied.');

    const atk  = await db.get('SELECT * FROM users WHERE id=?', atkId);
    const def  = await db.get('SELECT * FROM users WHERE id=?', defId);
    const town = await db.get('SELECT * FROM towns WHERE id=?', townId);
    if (!atk || !def || !town) return ephemeralReply(interaction, '⚠️ Data not found.');

    const siegeName = generateBattleName('SIEGE', {
        townName: town.name,
        attackerNation: atk.nation, defenderNation: def.nation,
        attackerRulerName: atk.ruler_name
    });

    const defSupplied = (def.food_surplus || 0) >= siegeFoodCostDef(def);

    const atkRoll  = Math.floor(Math.random() * 20) + 1;
    const defRoll  = Math.floor(Math.random() * 20) + 1;
    const agAtk    = await getAgBonus(db, atkId, atk);
    const agDef    = await getAgBonus(db, defId, def);
    const styxBonus = STYX_HOUSES.includes(ANCESTRIES[(def.ancestry || '').toUpperCase()]?.house) ? STYX_FORT_BONUS : 0;
    const terrainB  = TERRAIN_DEF[town.terrain_type] || 0;
    const defScore  = await calcDefenseScore(db, townId);
    const atkOff    = await calcOffenseScore(db, atkId);
    const menMod    = getMod(atk.attr_men || 10);
    const hasCav    = POLYSIA_KEYS.includes((atk.ancestry || '').toUpperCase()) && (atk.mil_cavalry || 0) > 0;
    const polyB     = hasCav ? POLYSIA_CAV_BONUS : 0;

    let atkPower = calcArmyPower(atk, 'siege_atk', town.terrain_type) + atkOff * 5 + menMod * 2 + polyB + atkRoll + agAtk;
    let defPower = calcArmyPower(def, 'siege_def', town.terrain_type) * 1.2 + defScore * 8 + terrainB + styxBonus + defRoll + agDef;
    if (!defSupplied) defPower = Math.floor(defPower * 0.5);

    const atkWins = atkPower > defPower;
    const winner  = atkWins ? atk : def;

    if (atkWins) {
        const al = 0.70 + Math.random() * 0.20;
        const dl = 0.40 + Math.random() * 0.30;
        await applySiegeCasualties(db, atk, al, true);
        await applySiegeCasualties(db, def, dl, false);
        await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-3) WHERE id=?', def.id);
        await db.run('UPDATE users SET rate_prest=MIN(10,rate_prest+2) WHERE id=?', atk.id);
        await db.run('INSERT INTO gm_events (user_id, gm_id, event_type, severity, effect_snapshot, created_at) VALUES (?,?,?,?,?,?)',
            winner.id, interaction.user.id, 'siege', 1,
            JSON.stringify({ atk: atkId, def: defId, winner: winner.id, battleName: siegeName }), Date.now());

        // Offer GM building destruction buttons
        const bldgs = await db.all('SELECT * FROM buildings WHERE town_id=?', townId);
        if (bldgs.length > 0) {
            const rows = [];
            let row = new ActionRowBuilder();
            for (let i = 0; i < bldgs.length && rows.length < 4; i++) {
                if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
                row.addComponents(new ButtonBuilder()
                    .setCustomId(`warsiege_destroy_${bldgs[i].id}_${def.id}`)
                    .setLabel(BUILDINGS[bldgs[i].type.toUpperCase()]?.name || bldgs[i].type)
                    .setStyle(ButtonStyle.Danger));
            }
            if (row.components.length > 0) rows.push(row);
            await interaction.update({ components: rows, content: `🏰 Siege resolved. **<@${atk.id}>** wins! Select a building to destroy in **${town.name}**:` });
            return;
        }
    } else {
        const dl = 0.85 + Math.random() * 0.10;
        const al = 0.60 + Math.random() * 0.20;
        await applySiegeCasualties(db, def, dl, false);
        await applySiegeCasualties(db, atk, al, true);
        await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-2) WHERE id=?', atk.id);
        await db.run('UPDATE users SET rate_prest=MIN(10,rate_prest+3) WHERE id=?', def.id);
        await db.run('INSERT INTO gm_events (user_id, gm_id, event_type, severity, effect_snapshot, created_at) VALUES (?,?,?,?,?,?)',
            winner.id, interaction.user.id, 'siege', 1,
            JSON.stringify({ atk: atkId, def: defId, winner: winner.id, battleName: siegeName }), Date.now());
        await interaction.update({ components: [], content: `🏰 Siege resolved. **<@${def.id}>** holds ${town.name}!` });
    }

    // Notify both players
    for (const uid of [atkId, defId]) {
        const userObj = uid === atkId ? atk : def;
        const chan    = await getNotificationChannel(interaction.client, userObj);
        const isWin   = uid === winner.id;
        const emb = new EmbedBuilder()
            .setTitle(`${isWin ? '🏆' : '💀'} ${siegeName}`)
            .setColor(isWin ? 0x00FF88 : 0xFF0000)
            .setDescription(`${siegeName}\nAtk: ${atkPower} vs Def: ${defPower}${!defSupplied ? ' *(defender undersupplied)*' : ''}\n${isWin ? '+2 Prestige' : atkWins ? '-3 Stability' : '-2 Stability'}`);
        let sent = false;
        if (chan) { try { await chan.send({ content: `<@${uid}>`, embeds: [emb] }); sent = true; } catch (_) {} }
        if (!sent) { try { const u = await interaction.client.users.fetch(uid); if (u) await u.send({ embeds: [emb] }); } catch (_) {} }
    }
}

// ─── GM DESTROYS A BUILDING AFTER SIEGE WIN ──────────────────────────────────

async function handleSiegeDestroy(interaction, bldgId, defId) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id)) return ephemeralReply(interaction, 'Access Denied.');
    await db.run('DELETE FROM buildings WHERE id=?', bldgId);
    await interaction.update({ components: [], content: interaction.message.content + '\n\n🔥 Building destroyed.' });
}

// ─── SIEGE CASUALTIES HELPER ─────────────────────────────────────────────────

async function applySiegeCasualties(db, user, surviveRatio, isAtk) {
    const inf = Math.max(0, Math.floor((user.mil_infantry || 0) * surviveRatio));
    const cav = Math.max(0, Math.floor((user.mil_cavalry  || 0) * surviveRatio));
    const rng = Math.max(0, Math.floor((user.mil_ranged   || 0) * surviveRatio));
    const sie = Math.max(0, Math.floor((user.mil_siege    || 0) * surviveRatio));
    const updated = { ...user, mil_infantry: inf, mil_cavalry: cav, mil_ranged: rng, mil_siege: sie };
    await db.run(
        'UPDATE users SET mil_infantry=?, mil_cavalry=?, mil_ranged=?, mil_siege=?, mil_maintenance_cost=? WHERE id=?',
        inf, cav, rng, sie, calcMaintenance(updated), user.id
    );
}

module.exports = {
    handleSiegeInitiate, handleSiegeConfirm, handleSiegeDestroy, applySiegeCasualties,
    siegeFoodCostAtk, siegeFoodCostDef
};
