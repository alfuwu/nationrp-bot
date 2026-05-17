const { ANCESTRIES, UPBRINGINGS, PROFESSIONS, STAT_MAPPING, VITALE_FREE_HOUSES, GREAT_HOUSES, PLAYER_RANKS } = require('../data/constants');

const OWNER_ID = process.env.OWNER_ID || '317883862258548737';
const STAT_KEYS = ['str', 'mot', 'men', 'int', 'wis', 'cha'];
const BASE_STAT = 10;

// ─── Character math ───────────────────────────────────────────────────────────

function getMod(value) {
    return Math.floor(((value ?? 10) - 10) / 2);
}

function fmtMod(mod) {
    return `${mod >= 0 ? '+' : ''}${mod}`;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isOwner(userId) {
    return userId === OWNER_ID;
}

async function isGM(db, userId) {
    if (isOwner(userId)) return true;
    const row = await db.get('SELECT 1 FROM gm_whitelist WHERE user_id = ?', userId);
    return Boolean(row);
}

// ─── Discord channel resolver ─────────────────────────────────────────────────

async function resolveAtlasHQ(client, embed, components = []) {
    const adminChanId = process.env.ADMIN_CHANNEL_ID || '1483005224376467599';
    try {
        const chan = await client.channels.fetch(adminChanId);
        if (chan) return await chan.send({ embeds: [embed], components });
    } catch (e) { console.error('[ATLAS] HQ Resolve Error:', e.message); }
    return null;
}

// ─── Stat boost engine (PF2e-style soft cap at 18) ───────────────────────────

function applyBoost(current, amount = 0) {
    if (!amount) return current;
    let val = current;
    for (let i = 0; i < amount; i++) {
        val = val >= 18 ? val + 1 : val + 2;
    }
    return val;
}

function buildBaseAttributes() {
    return { stat_str: 10, stat_mot: 10, stat_int: 10, stat_men: 10, stat_wis: 10, stat_cha: 10 };
}

function applyBoosts(stats, bonuses) {
    if (!bonuses) return;
    for (const [key, amt] of Object.entries(bonuses)) {
        if (key === 'all') {
            // SCION profession: +1 to every stat
            for (const k of Object.keys(stats)) {
                stats[k] = applyBoost(stats[k], amt);
            }
        } else if (stats[key] !== undefined) {
            stats[key] = applyBoost(stats[key], amt);
        }
    }
}

function decodeFreeDist(distStr) {
    if (!distStr) return { str: 0, mot: 0, int: 0, men: 0, wis: 0, cha: 0 };
    const dist = distStr.split('').map(Number);
    const keys = ['str', 'mot', 'int', 'men', 'wis', 'cha'];
    const result = {};
    keys.forEach((k, i) => result[k] = dist[i] || 0);
    return result;
}

// ─── FIXED: Stability multiplier ─────────────────────────────────────────────
//
// OLD (broken): stabMult = (rate_stab + 10) / 20
//   → at default +10 gives 1.0 (no upside ever), at -10 gives 0 (total wipe)
//
// NEW: soft curve with a meaningful upside and a safe floor
//   rate_stab range: -10 to +10
//   Output range:     0.30 to 1.30
//   At  0 (neutral): 0.75 multiplier
//   At +10 (max):    1.30 multiplier  (+30% bonus for high stability)
//   At -10 (floor):  0.30 multiplier  (70% penalty, not total wipe)
//
function calcStabMultiplier(rateStab) {
    const clamped = Math.max(-10, Math.min(10, rateStab ?? 0));
    // Linear map: -10 → 0.30, 0 → 0.75, +10 → 1.30
    // slope = (1.30 - 0.30) / 20 = 0.05 per point
    return 0.30 + ((clamped + 10) * 0.05);
}

// ─── Stat → macro-game bonus bridge ──────────────────────────────────────────
//
// Each character stat feeds one game system:
//   STR  → troop maintenance cost reduction (1% per mod point above 0)
//   MOT  → building construction speed bonus (no timer reduction, but "fast build" flag)
//   MEN  → scout/intimidate roll bonus       (+1 per mod point)
//   INT  → wealth production bonus           (+2% per mod point above 0)
//   WIS  → food efficiency bonus             (+2% per mod point above 0)
//   CHA  → faction relation gain bonus       (+1 per mod point above 0, per interaction)
//
// Returns an object with all bonuses pre-calculated for the given user row.
//
function getCharBonuses(user) {
    const strMod = Math.max(0, getMod(user.attr_str ?? 10));
    const motMod = Math.max(0, getMod(user.attr_mot ?? 10));
    const menMod = Math.max(0, getMod(user.attr_men ?? 10));
    const intMod = Math.max(0, getMod(user.attr_int ?? 10));
    const wisMod = Math.max(0, getMod(user.attr_wis ?? 10));
    const chaMod = Math.max(0, getMod(user.attr_cha ?? 10));

    return {
        // Reduce mil_maintenance_cost by 1% per STR mod point (capped at 30%)
        maintenanceDiscount: Math.min(0.30, strMod * 0.01),
        // Bonus to scout offense roll
        scoutBonus: menMod,
        // Wealth production multiplier bonus
        wealthBonus: 1 + (intMod * 0.02),
        // Food production multiplier bonus
        foodBonus: 1 + (wisMod * 0.02),
        // Flat bonus to faction relation score changes
        relationBonus: chaMod,
        // MOT: reserved for future build-timer reduction
        buildBonus: motMod,
    };
}

// ─── Population helpers ───────────────────────────────────────────────────────

// Returns true if nobles are satisfied (Vitale fully covered).
// Separated so both tax and population commands use the same logic.
function calcNobleState(user) {
    const commoners = user.pop_commoners ?? 100;

    // FIXED: Nobles don't appear until population reaches 200.
    // Below that threshold, new players have no noble demand to worry about.
    const nobles = commoners < 200 ? 0 : Math.floor(commoners / 50);

    const vitaleNeeded = Math.ceil(nobles / 5);
    const isSubsidized = !user.nation; // No nation = overlord subsidizes Vitale
    const hasEnoughVitale = isSubsidized || (user.vitale ?? 0) >= vitaleNeeded;

    // FIXED: Grace period for brand-new players (first 3 tax collections)
    // tax_count < 3 → no noble penalties even if Vitale deficit
    const taxCount = user.tax_count ?? 0;
    const inGracePeriod = taxCount < 3;

    return { nobles, vitaleNeeded, isSubsidized, hasEnoughVitale, inGracePeriod };
}

// ─── Warning level helper (used by tax & population embeds) ──────────────────
//
// Returns 'ok' | 'warn' | 'danger' based on current stability + prestige.
// Used to add yellow/red warning banners in embeds BEFORE crisis fires.
//
function getWarningLevel(rateStab, ratePrest) {
    const stab = rateStab ?? 0;
    const prest = ratePrest ?? 0;

    if (stab <= -5 || prest <= -3) return 'danger';   // Crisis imminent / already firing
    if (stab <= -2 || prest <= -1) return 'warn';     // Early warning
    return 'ok';
}

function formatWarningBanner(rateStab, ratePrest) {
    const level = getWarningLevel(rateStab, ratePrest);
    if (level === 'danger') {
        return '🔴 **CRISIS ALERT** — Stability or Prestige is critically low. Revolt or Rebellion may fire next tick!';
    }
    if (level === 'warn') {
        return '🟡 **WARNING** — Stability or Prestige is dropping. Take action before crisis events trigger.';
    }
    return null; // No banner needed
}

// ─── Rank helpers ─────────────────────────────────────────────────────────────

/**
 * Returns 'SOVEREIGN' | 'DOMINAR' | 'SCION' based on user's DB state.
 * Sovereign = has a nation. Dominar = has a town but no nation. Scion = no town.
 */
function getPlayerRank(user) {
    if (user.nation) return 'SOVEREIGN';
    if (user.player_rank === 'DOMINAR') return 'DOMINAR';
    return 'SCION';
}

/**
 * Returns true if a player's ancestry is permanently Vitale-subsidized.
 * Independent, Sciatic League, and Colonia Free Tribe never pay Vitale.
 */
function isVitaleFree(ancestryKey) {
    const entry = ANCESTRIES[(ancestryKey || '').toUpperCase()];
    if (!entry) return true; // unknown ancestry = treat as subsidized (safe default)
    return VITALE_FREE_HOUSES.includes(entry.house);
}

/**
 * Resolves a player's notification channel with fallback chain:
 * notification_channel → last_tax_channel → ADMIN_CHANNEL_ID
 */
async function getNotificationChannel(client, user) {
    const id = user.notification_channel || user.last_tax_channel || process.env.ADMIN_CHANNEL_ID;
    if (!id) return null;
    try { return await client.channels.fetch(id); }
    catch (_) { return null; }
}

// Sends a message to a player: tries DM first, falls back to interaction channel
async function sendToPlayer(client, interaction, userId, content) {
    try {
        const u = await client.users.fetch(userId);
        if (u) { await u.send(content); return; }
    } catch (_) {}
    try {
        if (interaction && interaction.channel) {
            await interaction.channel.send(content);
        }
    } catch (_) {}
}

async function getActivePlayers(db, excludeId) {
    return db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", excludeId);
}

// ─── Army maintenance ─────────────────────────────────────────────────────────

// Morale used by both warfare and colosseum systems
function calcMorale(user) {
    const base = 100 + (user.rate_stab || 0) * 3 + (user.rate_prest || 0) * 2
        - Math.max(0, -(user.food_surplus || 0)) * 5 - Math.floor((user.servus || 0) / 5) * 2;
    return Math.max(30, Math.min(150, base));
}

function calcMaintenance(user) {
    const inf = (user.mil_infantry || 0); // legacy column, migrate to mil_swordsman
    return ((user.mil_militia  || 0) * 1)
         + ((user.mil_spearmen || 0) * 1)
         + ((user.mil_swordsman|| 0) * 1)
         + (inf * 1)
         + ((user.mil_shield   || 0) * 1)
         + ((user.mil_cavalry  || 0) * 2)
         + ((user.mil_ranged   || 0) * 1)
         + ((user.mil_siege    || 0) * 3)
         + ((user.mercs_temp   || 0) * 1);
}

// ─── Database migrations ──────────────────────────────────────────────────────

async function initDB(db) {
    // Safe migrations — each silently skipped if column already exists
    const migrations = [
        // Core user columns
        'ALTER TABLE users ADD COLUMN last_tax INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN tax_count INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN tax_notified INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN last_tax_channel TEXT',
        'ALTER TABLE users ADD COLUMN nation TEXT',
        'ALTER TABLE users ADD COLUMN ruler_name TEXT',
        'ALTER TABLE users ADD COLUMN avatar_url TEXT',
        'ALTER TABLE users ADD COLUMN status TEXT DEFAULT "pending"',
        // Population
        'ALTER TABLE users ADD COLUMN pop_commoners INTEGER DEFAULT 100',
        'ALTER TABLE users ADD COLUMN pop_soldiers INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN pop_nobles INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN pop_servus INTEGER DEFAULT 0',
        // Rates
        'ALTER TABLE users ADD COLUMN rate_econ INTEGER DEFAULT 1',
        'ALTER TABLE users ADD COLUMN rate_def INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN rate_stab INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN rate_prest INTEGER DEFAULT 0',
        // Military
        'ALTER TABLE users ADD COLUMN mil_strength INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_maintenance_cost INTEGER DEFAULT 0',
        // Resources
        'ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 1000',
        'ALTER TABLE users ADD COLUMN wealth INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN food_surplus INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN ores INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN vitale INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN exotics INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN servus INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN metallurgy INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mercs_temp INTEGER DEFAULT 0',
        // Character
        'ALTER TABLE users ADD COLUMN attr_str INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN attr_mot INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN attr_men INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN attr_int INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN attr_wis INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN attr_cha INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN description TEXT',
        'ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN ancestry TEXT',
        'ALTER TABLE users ADD COLUMN upbringing TEXT',
        'ALTER TABLE users ADD COLUMN profession TEXT',
        // Rank system (Phase 1)
        'ALTER TABLE users ADD COLUMN player_rank TEXT DEFAULT "SCION"',
        'ALTER TABLE users ADD COLUMN great_house TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN custom_title TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN notification_channel TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN trade_route_slots INTEGER DEFAULT 3',
        // Town columns
        'ALTER TABLE towns ADD COLUMN fertility INTEGER DEFAULT 50',
        // Building columns
        'ALTER TABLE buildings ADD COLUMN ready_at INTEGER',
        // Relations
        'ALTER TABLE relations ADD COLUMN last_bribe INTEGER DEFAULT 0',
        // Army type columns
        'ALTER TABLE users ADD COLUMN mil_infantry INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_cavalry INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_ranged INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_siege INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN hp_current INTEGER DEFAULT 10',
        'ALTER TABLE users ADD COLUMN pending_battle TEXT DEFAULT NULL',
        // New infantry type columns
        'ALTER TABLE users ADD COLUMN mil_militia INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_spearmen INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_swordsman INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN mil_shield INTEGER DEFAULT 0',
    ];

    // Create tables that don't exist yet
    const newTables = [
        'CREATE TABLE IF NOT EXISTS gm_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, gm_id TEXT, event_type TEXT, severity INTEGER DEFAULT 1, effect_snapshot TEXT, resolved INTEGER DEFAULT 0, created_at INTEGER)',
        'CREATE TABLE IF NOT EXISTS trade_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, initiator_id TEXT, partner_id TEXT, partner_type TEXT, give_resource TEXT, give_amount INTEGER, receive_resource TEXT, receive_amount INTEGER, duration_turns INTEGER, turns_remaining INTEGER, status TEXT DEFAULT "active", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
        'CREATE TABLE IF NOT EXISTS treaties (id INTEGER PRIMARY KEY AUTOINCREMENT, initiator_id TEXT, partner_id TEXT, treaty_type TEXT, status TEXT DEFAULT "pending", turns_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
        'ALTER TABLE treaties ADD COLUMN broken_at INTEGER DEFAULT 0',
        'CREATE TABLE IF NOT EXISTS duels (id INTEGER PRIMARY KEY AUTOINCREMENT, challenger_id TEXT, defender_id TEXT, terrain TEXT, name TEXT, status TEXT DEFAULT "pending", challenger_hp INTEGER DEFAULT 10, defender_hp INTEGER DEFAULT 10, round INTEGER DEFAULT 0, challenger_stance TEXT, defender_stance TEXT, winner_id TEXT, created_at INTEGER)',
        'ALTER TABLE duels ADD COLUMN name TEXT',
        'CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, duel_id INTEGER, bettor_id TEXT, amount INTEGER, bet_on TEXT, odds REAL, payout INTEGER DEFAULT 0, created_at INTEGER)',
    ];
    for (const sql of newTables) {
        try { await db.run(sql); } catch (_) {}
    }

    for (const sql of migrations) {
        try { await db.run(sql); } catch (_) { /* column already exists — skip */ }
    }

    // ── DATA FIXES ───────────────────────────────────────────────────────────

    // FIX 1: stat_* → attr_* migration
    // The old schema had stat_str/mot/etc. The new schema uses attr_str/mot/etc.
    // If any row has stat_str != 8 (old default) but attr_str == 10 (new default),
    // the stat_ columns have real data that never got copied to attr_.
    // We copy stat_ → attr_ for any row where attr_ is still at the new default (10)
    // AND stat_ has been customized (anything other than 8).
    try {
        await db.run(`
            UPDATE users SET
                attr_str = stat_str, attr_mot = stat_mot, attr_men = stat_men,
                attr_int = stat_int, attr_wis = stat_wis, attr_cha = stat_cha
            WHERE
                stat_str IS NOT NULL AND stat_str != 8
                AND attr_str = 10
        `);
        console.log('[DB] FIX 1: stat_* → attr_* migration applied where needed.');
    } catch (e) { /* stat_ columns may not exist in a fresh install — ok */ }

    // FIX 2: pop_common → pop_commoners
    try {
        await db.run(`
            UPDATE users
            SET pop_commoners = pop_common
            WHERE pop_commoners = 100 AND pop_common IS NOT NULL AND pop_common != 100
        `);
        console.log('[DB] FIX 2: pop_common → pop_commoners migration applied.');
    } catch (e) { /* pop_common may not exist — ok */ }

    // FIX 3: nation_name → nation
    try {
        await db.run(`
            UPDATE users
            SET nation = nation_name
            WHERE nation IS NULL AND nation_name IS NOT NULL
        `);
        console.log('[DB] FIX 3: nation_name → nation migration applied.');
    } catch (e) { /* nation_name may not exist — ok */ }

    // FIX 4: Clean up orphaned buildings (buildings whose town_id no longer exists)
    try {
        const result = await db.run(`
            DELETE FROM buildings
            WHERE town_id NOT IN (SELECT id FROM towns)
        `);
        if (result.changes > 0) {
            console.log(`[DB] FIX 4: Removed ${result.changes} orphaned building(s) with no matching town.`);
        }
    } catch (e) { console.error('[DB] FIX 4 failed:', e.message); }

    // FIX 6: Migrate legacy mil_infantry → mil_swordsman
    try {
        const result = await db.run(`
            UPDATE users SET mil_swordsman = COALESCE(mil_swordsman,0) + COALESCE(mil_infantry,0),
            mil_infantry = 0
            WHERE mil_infantry > 0
        `);
        if (result.changes > 0) {
            console.log(`[DB] FIX 6: Migrated ${result.changes} players\' mil_infantry → mil_swordsman.`);
        }
    } catch (e) { console.error('[DB] FIX 6 failed:', e.message); }
    // Sets mil_maintenance_cost = pop_soldiers * 1 (1 food per soldier per day)
    // for any row where soldiers > 0 but maintenance_cost is still 0.
    try {
        await db.run(`
            UPDATE users
            SET mil_maintenance_cost = pop_soldiers
            WHERE pop_soldiers > 0 AND mil_maintenance_cost = 0
        `);
        console.log('[DB] FIX 5: mil_maintenance_cost initialized for existing armies.');
    } catch (e) { console.error('[DB] FIX 5 failed:', e.message); }

    console.log('[DB] All migrations and fixes complete.');
}

module.exports = {
    OWNER_ID, STAT_KEYS, BASE_STAT,
    getMod, fmtMod, isOwner, isGM, resolveAtlasHQ,
    applyBoost, applyBoosts, buildBaseAttributes, decodeFreeDist,
    calcStabMultiplier, getCharBonuses, calcNobleState,
    getWarningLevel, formatWarningBanner,
    getPlayerRank, isVitaleFree, getNotificationChannel,
    sendToPlayer, getActivePlayers,
    calcMorale,
    calcMaintenance,
    initDB, STAT_MAPPING,
    GREAT_HOUSES, PLAYER_RANKS, VITALE_FREE_HOUSES
};
