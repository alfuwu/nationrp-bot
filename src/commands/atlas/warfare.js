/**
 * warfare.js — Shared constants, combat math, and button/modal router
 *
 * This file owns:
 *   • Terrain / faction constants
 *   • Pure calculation functions (calcArmyPower, calcOffenseScore, etc.)
 *   • handleButton / handleModal routing
 *   • handleRebellionEvent (used by scheduler/events.js)
 *
 * Actual business logic lives in the three sub-modules:
 *   • warfare_battle.js  — field battles
 *   • warfare_siege.js   — town sieges
 *   • warfare_raid.js    — raids
 */

'use strict';

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { ANCESTRIES, TERRAINS } = require('../../data/constants');
const {
    getMod, resolveAtlasHQ, isGM, calcMaintenance, calcMorale, ephemeralReply
} = require('../../utils/helpers');
const { generateBattleName, classifyBattle } = require('./battlename');

// ─── SHARED CONSTANTS ────────────────────────────────────────────────────────

const TERRAIN_DEF = { MOUNTAIN: 15, FOREST: 8, HILLS: 5, RIVERLANDS: 3, PLAINS: 0, COASTAL: -2, SWAMP: 6 };

const TERRAIN_COMBAT_MODS = {
    FOREST:     { cav: -0.4, rng: +0.2 },
    HILLS:      { rng: +0.3, inf: +0.1 },
    RIVERLANDS: { cav: -0.5, inf: -0.1 },
    SWAMP:      { cav: -0.6, sie: -0.4 },
    PLAINS:     { cav: +0.2 },
};

const POLYSIA_KEYS      = ['POLYSIA-ESTUARIN', 'POLYSIA-RIPARIAN'];
const STYX_HOUSES       = ['TYRANNITE', 'RHAGAIA', 'SELLESELA', 'GAIUS', 'CAOSSA'];
const POLYSIA_CAV_BONUS = 10;
const STYX_FORT_BONUS   = 8;

// ─── SHARED UTILITIES ────────────────────────────────────────────────────────

function encodeName(name)    { return (name || '').replace(/ /g, '-'); }
function decodeName(encoded) { return (encoded || '').replace(/-/g, ' '); }

// ─── COMBAT MATH ─────────────────────────────────────────────────────────────

/**
 * Calculate effective army power for a player, factoring in terrain and morale.
 * @param {object} user      DB row with mil_* columns
 * @param {string} context   'field' | 'siege_atk' | 'siege_def'
 * @param {string} [terrainType]
 */
function calcArmyPower(user, context, terrainType) {
    const inf = (user.mil_militia || 0) + (user.mil_spearmen || 0) + (user.mil_swordsman || 0) + (user.mil_shield || 0) + (user.mercs_temp || 0);
    const cav = user.mil_cavalry || 0;
    const rng = user.mil_ranged  || 0;
    const sig = user.mil_siege   || 0;

    const tMods = (context === 'field' && terrainType)
        ? (TERRAIN_COMBAT_MODS[terrainType.toUpperCase()] || {}) : {};

    let raw = 0;
    if (context === 'field') {
        raw = inf * (1.0 + (tMods.inf || 0))
            + cav * (1.5 + (tMods.cav || 0))
            + rng * (1.0 + (tMods.rng || 0))
            + sig * (0.0 + (tMods.sie || 0));
    } else if (context === 'siege_atk') {
        raw = inf * 1.0 + cav * 0.8 + rng * 1.0 + sig * 2.0;
    } else if (context === 'siege_def') {
        raw = inf * 1.0 + cav * 0.8 + rng * 1.2 + sig * 0.5;
    }
    return Math.floor(raw * (calcMorale(user) / 100));
}

/** Composition counter-bonus: cav vs archer-heavy, ranged vs infantry-heavy. */
function compCounterBonus(atk, def) {
    const defInf = (def.mil_militia || 0) + (def.mil_spearmen || 0) + (def.mil_swordsman || 0) + (def.mil_shield || 0);
    if ((atk.mil_cavalry || 0) > 0 && (def.mil_ranged || 0) > defInf) return 5;
    if ((atk.mil_ranged  || 0) > 0 && defInf > (def.mil_cavalry || 0)) return 3;
    return 0;
}

/** Total offensive infrastructure score (Barracks/Castle/Palace) across all towns. */
async function calcOffenseScore(db, userId) {
    const towns = await db.all('SELECT id FROM towns WHERE user_id=?', userId);
    let score = 0;
    for (const t of towns) {
        const bldgs = await db.all('SELECT type FROM buildings WHERE town_id=? AND (ready_at IS NULL OR ready_at<=?)', t.id, Date.now());
        for (const b of bldgs) {
            const bt = b.type.toUpperCase();
            if (bt === 'BARRACKS') score += 1;
            if (bt === 'CASTLE')   score += 2;
            if (bt === 'PALACE')   score += 3;
        }
    }
    return score;
}

/** Total defensive infrastructure score for a specific town. */
async function calcDefenseScore(db, townId) {
    const bldgs = await db.all('SELECT type FROM buildings WHERE town_id=? AND (ready_at IS NULL OR ready_at<=?)', townId, Date.now());
    let score = 0;
    for (const b of bldgs) {
        const bt = b.type.toUpperCase();
        if (bt === 'PALISADE')      score += 1;
        if (bt === 'BASIC_WALL')    score += 2;
        if (bt === 'ADVANCED_WALL') score += 3;
        if (bt === 'CASTLE')        score += 5;
    }
    return score;
}

/** Atomic Guild intelligence bonus (≥15 relation → INT/WIS mod). */
async function getAgBonus(db, userId, user) {
    const ag = await db.get('SELECT score FROM relations WHERE user_id=? AND faction_name=?', userId, 'Atomic Guild');
    if (ag?.score >= 15) return Math.max(0, getMod(user.attr_int || 10), getMod(user.attr_wis || 10));
    return 0;
}

// ─── SUB-MODULE IMPORTS ───────────────────────────────────────────────────────

// Lazy-load sub-modules to avoid circular-require issues at startup
let _battle, _siege, _raid;
function battle() { return _battle || (_battle = require('./warfare_battle')); }
function siege()  { return _siege  || (_siege  = require('./warfare_siege'));  }
function raid()   { return _raid   || (_raid   = require('./warfare_raid'));   }

// ─── REBELLION EVENT (used by scheduler / events.js) ─────────────────────────

async function handleRebellionEvent(db, user) {
    // Servus rebellion: stab ≤ -5 AND servus > 0
    const servusCount = user.servus || 0;
    const stab        = user.rate_stab || 0;
    if (stab <= -5 && servusCount > 0) {
        const rebelStr = servusCount * 3;
        const armyPow  = calcArmyPower(user, 'field');
        if (armyPow > rebelStr) {
            await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-1), servus=MAX(0,servus-5) WHERE id=?', user.id);
            return { type: 'servus', result: 'suppressed' };
        } else {
            await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-5), wealth=MAX(0,wealth-2000), servus=0 WHERE id=?', user.id);
            const bldg = await db.get('SELECT id FROM buildings WHERE town_id IN (SELECT id FROM towns WHERE user_id=?) ORDER BY RANDOM() LIMIT 1', user.id);
            if (bldg) await db.run('DELETE FROM buildings WHERE id=?', bldg.id);
            return { type: 'servus', result: 'overwhelmed', buildingDestroyed: !!bldg };
        }
    }

    // Noble revolt: prest ≤ -3 AND pop ≥ 200
    const prest = user.rate_prest || 0;
    const pop   = user.pop_commoners || 0;
    if (prest <= -3 && pop >= 200) {
        const nobles    = Math.floor(pop / 50);
        const defectors = Math.floor(nobles * Math.abs(prest) / 10);
        const armyPow   = calcArmyPower(user, 'field');
        if (armyPow > defectors * 10) {
            await db.run('UPDATE users SET rate_prest=MAX(-10,rate_prest-1) WHERE id=?', user.id);
            return { type: 'noble', result: 'suppressed' };
        } else {
            await db.run('UPDATE users SET rate_prest=MAX(-10,rate_prest-5), status="deposed" WHERE id=?', user.id);
            return { type: 'noble', result: 'deposed' };
        }
    }
    return null;
}

// ─── BUTTON HANDLER (routes to sub-modules) ──────────────────────────────────

async function handleButton(interaction, action, args) {
    // ── Battle GM buttons ──────────────────────────────────────────────────
    if (action === 'warapprove' && args[0] === 'battle') {
        if (!await isGM(interaction.client.db, interaction.user.id))
            return ephemeralReply(interaction, 'Access Denied.');
        const modal = new ModalBuilder()
            .setCustomId(`warbattlename_${args.slice(1).join('_')}`)
            .setTitle('⚔️ Name This Battle');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('battle_name').setLabel('Battle Name (leave blank to auto-generate)')
                .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)
                .setPlaceholder('e.g. Battle of the Iron Gate')
        ));
        return await interaction.showModal(modal);
    }

    if (action === 'warreject' && args[0] === 'battle') {
        if (!await isGM(interaction.client.db, interaction.user.id))
            return ephemeralReply(interaction, 'Access Denied.');
        // Refund food to attacker (stored as last arg in customId)
        const refund = parseInt(args[3]) || parseInt(args[4]) || 0;
        if (refund > 0)
            await interaction.client.db.run('UPDATE users SET food_surplus=food_surplus+? WHERE id=?', refund, args[1]);
        await interaction.update({ components: [], content: '❌ Battle rejected. Food refunded.' });
        return;
    }

    if (action === 'warbattle' && args[0] === 'ss')
        return battle().handleBattleSubstat(interaction, args[1], args[2]);

    // ── Defender flow ──────────────────────────────────────────────────────
    if (action === 'wardefcommit')
        return battle().handleDefenderCommit(interaction, args[0], args[1], args[2]);

    if (action === 'wardefform')
        return battle().handleDefenderFormationPick(interaction, args[0], args[1], args[2], args[3]);

    // ── Siege GM buttons ───────────────────────────────────────────────────
    if (action === 'warconfirm' && args[0] === 's')
        return siege().handleSiegeConfirm(interaction, args[1], args[2], args[3]);

    if (action === 'warabort' && args[0] === 's') {
        if (!await isGM(interaction.client.db, interaction.user.id))
            return ephemeralReply(interaction, 'Access Denied.');
        await interaction.update({ components: [], content: '❌ Siege aborted.' });
        return;
    }

    if (action === 'warsiege' && args[0] === 'destroy')
        return siege().handleSiegeDestroy(interaction, args[1], args[2]);

    // ── Raid GM buttons ────────────────────────────────────────────────────
    if (action === 'warraid' && args[0] === 'approve') {
        if (!await isGM(interaction.client.db, interaction.user.id))
            return ephemeralReply(interaction, 'Access Denied.');
        const compArgs  = args.length > 3 ? args.slice(3, 8) : null;
        const townEnc   = args.length > 8 ? args[8] : null;
        return raid().handleRaidApprove(interaction, args[1], args[2], compArgs, townEnc);
    }

    if (action === 'warraid' && args[0] === 'abort') {
        if (!await isGM(interaction.client.db, interaction.user.id))
            return ephemeralReply(interaction, 'Access Denied.');
        await interaction.update({ components: [], content: '❌ Raid aborted.' });
        return;
    }

    // ── Raider withdraw decision ───────────────────────────────────────────
    if (action === 'raidwithdraw') {
        const battleData = args.slice(1).join('_');
        if (args[0] === 'now')   return raid().handleRaidWithdraw(interaction, battleData, true);
        if (args[0] === 'press') return raid().handleRaidWithdraw(interaction, battleData, false);
    }
}

// ─── MODAL HANDLER (GM battle naming is the only modal in this module) ───────

async function handleModal(interaction, action, args) {
    if (action === 'warbattlename') {
        const atkId    = args[0];
        const defId    = args[1];
        const compArgs = args.slice(2);
        return battle().handleBattleNameSubmit(interaction, atkId, defId, compArgs);
    }
    if (action === 'warcomp') {
        const atkId = args[0];
        const defId = args[1];
        return battle().handleBattleCompositionSubmit(interaction, atkId, defId);
    }
    if (action === 'wardefmodal') {
        const atkId      = args[0];
        const defId      = args[1];
        const atkCompStr = args.slice(2, args.length - 1).join('_');
        const formKey    = args[args.length - 1];
        return battle().handleBattleResolve(interaction, atkId, defId, atkCompStr, formKey);
    }
    if (action === 'warraid') {
        const atkId       = args[0];
        const defId       = args[1];
        const townNameEnc = args[2] || null;
        return raid().handleRaidCompositionSubmit(interaction, atkId, defId, townNameEnc);
    }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
    // Shared constants (re-exported so sub-modules can require('./warfare'))
    TERRAIN_DEF, TERRAIN_COMBAT_MODS,
    POLYSIA_KEYS, STYX_HOUSES, POLYSIA_CAV_BONUS, STYX_FORT_BONUS,
    encodeName, decodeName,

    // Shared math
    calcArmyPower, compCounterBonus, calcOffenseScore, calcDefenseScore, getAgBonus,

    // Top-level handlers (called by interactionCreate.js)
    handleButton, handleModal, handleRebellionEvent,

    // Entry points called directly by atlas.js slash command handler
    handleBattleInitiate:          (...a) => battle().handleBattleInitiate(...a),
    handleBattleCompositionSubmit: (...a) => battle().handleBattleCompositionSubmit(...a),
    handleBattleNameSubmit:        (...a) => battle().handleBattleNameSubmit(...a),
    handleDefenderCommit:          (...a) => battle().handleDefenderCommit(...a),
    handleDefenderFormationPick:   (...a) => battle().handleDefenderFormationPick(...a),
    handleBattleResolve:           (...a) => battle().handleBattleResolve(...a),
    handleSiegeInitiate:           (...a) => siege().handleSiegeInitiate(...a),
    handleRaidInitiate:            (...a) => raid().handleRaidInitiate(...a),
    handleRaidCompositionSubmit:   (...a) => raid().handleRaidCompositionSubmit(...a),
};
