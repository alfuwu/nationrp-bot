const { ButtonStyle } = require('discord.js');

const EMOJIS = {
    wealth: '⚖️', food: '🥩', ores: '⚒️', vitale: '💧', exotics: '🍷',
    balance: ':coin:', servus: '🔗', metallurgy: '🔩',
    str: '💪', mot: '🏃', men: '💀', int: '🧠', wis: '🕯️', cha: '🎭'
};

const TERRAINS = {
    PLAINS:     { name: 'Plains',     plots: 24, bonus: '+20% Food',     color: 0x77DD77, img: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1000&q=80' },
    MOUNTAIN:   { name: 'Mountain',   plots: 12, bonus: '+50% Ores',     color: 0x888888, img: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1000&q=80' },
    FOREST:     { name: 'Forest',     plots: 20, bonus: '+10 Defense',   color: 0x228B22, img: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80' },
    COASTAL:    { name: 'Coastal',    plots: 18, bonus: '+20% Wealth',   color: 0x00BFFF, img: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?auto=format&fit=crop&w=1000&q=80' },
    HILLS:      { name: 'Hills',      plots: 14, bonus: '+10% Ores',     color: 0xDAA520, img: 'https://images.unsplash.com/photo-1464638681273-0962e9b53566?auto=format&fit=crop&w=1000&q=80' },
    RIVERLANDS: { name: 'Riverlands', plots: 22, bonus: '+30% Food',     color: 0x40E0D0, img: 'https://images.unsplash.com/photo-1437482078695-73f5ca6c96e2?auto=format&fit=crop&w=1000&q=80' },
    SWAMP:      { name: 'Swamp',      plots: 10, bonus: '-20% Economy',  color: 0x2E8B57, img: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1000&q=80' }
};

const TERRAIN_MULTIPLIERS = {
    PLAINS:     { food: 1.2, wealth: 1.0, ore: 1.0 },
    RIVERLANDS: { food: 1.3, wealth: 1.0, ore: 1.0 },
    MOUNTAIN:   { food: 1.0, wealth: 1.0, ore: 1.5 },
    COASTAL:    { food: 1.0, wealth: 1.2, ore: 1.0 },
    FOREST:     { food: 1.0, wealth: 1.0, ore: 1.0 },
    HILLS:      { food: 1.0, wealth: 1.0, ore: 1.1 },
    SWAMP:      { food: 1.0, wealth: 0.8, ore: 1.0 }
};

const BUILDINGS = {
    // ─── ECONOMY ─────────────────────────────────────────────────────────────
    FARM:      { name: 'Farm',      category: 'ECONOMY',   tier: 1, plots: 4,  cost: 100,  emoji: '🌾', desc: 'Income: +10 ⚖️/day. +100 🥩/day.',          income_wealth: 10,  food_prod: 100, food_cost: 0,   ore_prod: 0,  pop_cap_bonus: 100, stab_bonus: 0 },
    LIVESTOCK: { name: 'Livestock', category: 'ECONOMY',   tier: 2, plots: 6,  cost: 400,  emoji: '🐄', desc: 'Income: +20 ⚖️/day. +300 🥩/day.',          income_wealth: 20,  food_prod: 300, food_cost: 0,   ore_prod: 0,  pop_cap_bonus: 200, stab_bonus: 0, upgrade_from: 'FARM' },
    MARKET:    { name: 'Market',    category: 'ECONOMY',   tier: 3, plots: 8,  cost: 800,  emoji: '⚖️', desc: 'Income: +80 ⚖️/day.',                       income_wealth: 80,  food_prod: 0,   food_cost: 0,   ore_prod: 0,  pop_cap_bonus: 0,   stab_bonus: 0, upgrade_from: 'LIVESTOCK' },

    // ─── MINING / INDUSTRY ────────────────────────────────────────────────────
    MINE:          { name: 'Mine',           category: 'ECONOMY',  tier: 1, plots: 4, cost: 500,  emoji: '⛏️', desc: '+30 ⚒️ Ores/day. Mountain/Hills terrain ×2.',                income_wealth: 0, food_prod: 0, food_cost: 0,   ore_prod: 30, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0 },
    DEEP_MINE:     { name: 'Deep Mine',      category: 'ECONOMY',  tier: 2, plots: 6, cost: 1000, emoji: '🪨', desc: '+70 ⚒️ Ores/day. Mountain/Hills ×2. Costs 10 🥩/day.',       income_wealth: 0, food_prod: 0, food_cost: 10,  ore_prod: 70, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0, upgrade_from: 'MINE' },
    FURNACE:       { name: 'Furnace',        category: 'INDUSTRY', tier: 1, plots: 4, cost: 600,  emoji: '🔥', desc: 'Converts 50 ⚒️ → 10 🔩 Metallurgy/day. Costs 20 🥩/day.',   income_wealth: 0, food_prod: 0, food_cost: 20,  ore_prod: 0,  ore_consumption: 50, metallurgy_prod: 10, pop_cap_bonus: 0, stab_bonus: 0 },
    SMELTERY:      { name: 'Smeltery',       category: 'INDUSTRY', tier: 2, plots: 6, cost: 1200, emoji: '⚙️', desc: 'Converts 80 ⚒️ → 20 🔩/day. Caossa ancestry produces 30.',  income_wealth: 0, food_prod: 0, food_cost: 30,  ore_prod: 0,  ore_consumption: 80, metallurgy_prod: 20, pop_cap_bonus: 0, stab_bonus: 0, upgrade_from: 'FURNACE' },
    EXOTIC_WORKSHOP: { name: 'Exotic Workshop', category: 'INDUSTRY', tier: 1, plots: 3, cost: 800, emoji: '🍷', desc: '+2 🍷 Exotics/day. +1 Stability. Costs 10 🥩/day.', income_wealth: 20, food_prod: 0, food_cost: 10, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, exotic_prod: 2, pop_cap_bonus: 50, stab_bonus: 1 },

    // ─── DEFENSE ─────────────────────────────────────────────────────────────
    PALISADE:      { name: 'Palisade',      category: 'DEFENSE',   tier: 1, plots: 2,  cost: 300,  emoji: '🪵', desc: '+1 Defense Score.',                 income_wealth: 0, food_prod: 0, food_cost: 0,   ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0 },
    BASIC_WALL:    { name: 'Basic Wall',    category: 'DEFENSE',   tier: 2, plots: 4,  cost: 600,  emoji: '🧱', desc: '+2 Defense Score.',                 income_wealth: 0, food_prod: 0, food_cost: 0,   ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0, upgrade_from: 'PALISADE' },
    ADVANCED_WALL: { name: 'Advanced Wall', category: 'DEFENSE',   tier: 3, plots: 6,  cost: 900,  emoji: '🏰', desc: '+3 Defense Score.',                 income_wealth: 0, food_prod: 0, food_cost: 0,   ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0, upgrade_from: 'BASIC_WALL' },

    // ─── STABILITY ────────────────────────────────────────────────────────────
    CHURCH:           { name: 'Church',           category: 'STABILITY', tier: 1, plots: 2, cost: 300,  emoji: '⛪', desc: '+1 Stability. +50 pop cap.',  income_wealth: 0, food_prod: 0, food_cost: 0, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 50,  stab_bonus: 1 },
    MOTHERS_GUILD:    { name: 'Mothers Guild',    category: 'STABILITY', tier: 2, plots: 4, cost: 600,  emoji: '🤱', desc: '+2 Stability. +150 pop cap.', income_wealth: 0, food_prod: 0, food_cost: 0, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 150, stab_bonus: 2, upgrade_from: 'CHURCH' },
    IMPERIAL_ACADEMY: { name: 'Imperial Academy', category: 'STABILITY', tier: 3, plots: 8, cost: 1200, emoji: '🎓', desc: '+3 Stability. +300 pop cap.', income_wealth: 0, food_prod: 0, food_cost: 0, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 300, stab_bonus: 3, upgrade_from: 'MOTHERS_GUILD' },

    // ─── MILITARY ─────────────────────────────────────────────────────────────
    BARRACKS: { name: 'Barracks', category: 'MILITARY', tier: 1, plots: 6,  cost: 900,  emoji: '🛡️', desc: '+1 Offense. +2 Stability. Upkeep: 50 🥩/day.',  income_wealth: 0, food_prod: 0, food_cost: 50,  ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 2 },
    CASTLE:   { name: 'Castle',   category: 'MILITARY', tier: 2, plots: 10, cost: 1500, emoji: '🏯', desc: '+2 Offense. +4 Stability. Upkeep: 100 🥩/day.', income_wealth: 0, food_prod: 0, food_cost: 100, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 4, upgrade_from: 'BARRACKS' },
    PALACE:   { name: 'Palace',   category: 'MILITARY', tier: 3, plots: 12, cost: 2000, emoji: '👑', desc: '+3 Offense. +6 Stability. Upkeep: 150 🥩/day.', income_wealth: 0, food_prod: 0, food_cost: 150, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 6, upgrade_from: 'CASTLE' },

    // ─── UTILITY ──────────────────────────────────────────────────────────────
    TAVERN: { name: 'Tavern', category: 'UTILITY', tier: 1, plots: 3, cost: 450, emoji: '🍺', desc: '+30 ⚖️/day.', income_wealth: 30, food_prod: 0, food_cost: 0, ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 0 },
    GARDEN:  { name: 'Garden',  category: 'UTILITY', tier: 1, plots: 2, cost: 300, emoji: '🌹', desc: '+1 Stability.',                income_wealth: 0,  food_prod: 0, food_cost: 0,   ore_prod: 0, ore_consumption: 0, metallurgy_prod: 0, pop_cap_bonus: 0, stab_bonus: 1 }
};

// ─── ANCESTRIES ───────────────────────────────────────────────────────────────
// Akha removed — lore unconfirmed
const ANCESTRIES = {
    ALEXIANS:          { name: 'Alexians',         bonuses: { stat_int: 2, stat_men: 1 }, desc: 'Architects of law and empire.',                                                                     color: 0xE0E0E0, emoji: '⚪', style: ButtonStyle.Secondary, house: 'INDEPENDENT'     },
    DAXOS:             { name: 'Daxos',            bonuses: { stat_cha: 2, stat_int: 1 }, desc: 'Masters of commerce and guild trade.',                                                              color: 0xCC0000, emoji: '🔴', style: ButtonStyle.Danger,    house: 'CAOSSA'          },
    ELVISH:            { name: 'Elvish',           bonuses: { stat_mot: 2, stat_wis: 1 }, desc: 'Harmony of the multicultural tribes.',                                                              color: 0x1A7A40, emoji: '🟢', style: ButtonStyle.Success,   house: 'COLONIA_FREE_TRIBE' },
    INCANZIL:          { name: 'Incanzil',         bonuses: { stat_wis: 2, stat_int: 1 }, desc: 'Sages and philosopher-kings atop peaks.',                                                           color: 0xEDB2ED, emoji: '🟣', style: ButtonStyle.Primary,   house: 'RHAGAIA'         },
    LINERIAN:          { name: 'Linerian',         bonuses: { stat_cha: 2, stat_mot: 1 }, desc: 'The adaptable and diplomatic lineage.',                                                             color: 0xADFF2F, emoji: '🟢', style: ButtonStyle.Success,   house: 'INDEPENDENT'     },
    'POLYSIA-ESTUARIN':{ name: 'Polysia-Estuarin', bonuses: { stat_mot: 2, stat_cha: 1 }, desc: 'Masters of intricate stone architecture and ancestral courtyards in the western seas.',            color: 0x512E5F, emoji: '🗿', style: ButtonStyle.Primary,   house: 'SELLESELA'       },
    'POLYSIA-RIPARIAN':{ name: 'Polysia-Riparian', bonuses: { stat_wis: 2, stat_int: 1 }, desc: 'Resourceful dwellers of the eastern swamps, known for sacred fire dances and canoe burials.',     color: 0x2E8B57, emoji: '🛶', style: ButtonStyle.Success,   house: 'SELLESELA'       },
    SCIATIC:           { name: 'Sciatic',          bonuses: { stat_int: 2, stat_mot: 1 }, desc: 'Navigators of the great oceanic trade routes.',                                                    color: 0x85C1E9, emoji: '🔵', style: ButtonStyle.Primary,   house: 'SCIATIC_LEAGUE'  },
    SONG:              { name: 'Song',             bonuses: { stat_int: 2, stat_cha: 1 }, desc: '⚠️ *Lore unconfirmed — description pending.*',                                                     color: 0xF9E79F, emoji: '🟡', style: ButtonStyle.Secondary, house: 'INDEPENDENT'     },
    STYX:              { name: 'Styx',             bonuses: { stat_men: 2, stat_cha: 1 }, desc: 'The majestic synthesis of sword and silk.',                                                         color: 0xFF0000, emoji: '🔴', style: ButtonStyle.Danger,    house: 'TYRANNITE'       },
    TOLKHAI:           { name: 'Tolkhai',          bonuses: { stat_str: 2, stat_mot: 1 }, desc: 'Lords of the endless steppe.',                                                                      color: 0xC6EDB2, emoji: '🟢', style: ButtonStyle.Success,   house: 'GAIUS'           },
    TORA:              { name: 'Tora',             bonuses: { stat_wis: 2, stat_str: 1 }, desc: '⚠️ *Lore pending — details forthcoming from the Imperial Lorebook.*',                              color: 0xC19A6B, emoji: '🏺', style: ButtonStyle.Secondary, house: 'CAOSSA'          }
};

// ─── GREAT HOUSES ─────────────────────────────────────────────────────────────
const GREAT_HOUSES = {
    TYRANNITE:         { name: 'Tyrannite',    color: 0xFF0000,  emoji: '⚔️' },
    RHAGAIA:           { name: 'Rhagaia',      color: 0xEDB2ED,  emoji: '📜' },
    SELLESELA:         { name: 'Sellesela',    color: 0x512E5F,  emoji: '🗿' },
    GAIUS:             { name: 'Gaius',        color: 0xC6EDB2,  emoji: '🐎' },
    CAOSSA:            { name: 'Caossa',       color: 0xFFDAB9,  emoji: '🏺' },
    INDEPENDENT:       { name: 'Independent',  color: 0xAAAAAA,  emoji: '🌐' },
    SCIATIC_LEAGUE:    { name: 'Sciatic League', color: 0x85C1E9, emoji: '⚓' },
    COLONIA_FREE_TRIBE:{ name: 'Colonia Free Tribe', color: 0x1A7A40, emoji: '🌿' }
};

// Houses that never pay Vitale (permanently subsidized)
const VITALE_FREE_HOUSES = ['INDEPENDENT', 'SCIATIC_LEAGUE', 'COLONIA_FREE_TRIBE'];

// ─── PLAYER RANKS ─────────────────────────────────────────────────────────────
const PLAYER_RANKS = {
    SCION:     { name: 'Scion',     emoji: '🎓', titleFormat: 'Scion of {house}',    desc: 'Enrolled in Imperial Academy. Vitale fully subsidized.' },
    DOMINAR:   { name: 'Dominar',   emoji: '🏡', titleFormat: 'Dominar of {town}',   desc: 'Settlement owner. Vitale shown informatively.' },
    SOVEREIGN: { name: 'Sovereign', emoji: '👑', titleFormat: '{custom_title}',       desc: 'Nation founder. Pays full Vitale cost.' }
};

const UPBRINGINGS = {
    YARD:    { name: 'The Martial Yard',    bonuses: { stat_str: 2, stat_men: 1 }, desc: 'Youth amidst steel.' },
    HALL:    { name: 'The Scriptural Hall', bonuses: { stat_int: 2, stat_wis: 1 }, desc: 'Parchment and logic.' },
    STREETS: { name: 'The Market Streets',  bonuses: { stat_cha: 2, stat_mot: 1 }, desc: 'The deal and shadows.' }
};

const PROFESSIONS = {
    COMMANDER: { name: 'Commander', bonuses: { stat_men: 2 },  desc: 'Legion Leader.' },
    MERCHANT:  { name: 'Merchant',  bonuses: { stat_cha: 2 },  desc: 'Master of trade.' },
    PRIEST:    { name: 'Priest',    bonuses: { stat_wis: 2 },  desc: 'Keeper of Flame.' },
    SCHOLAR:   { name: 'Scholar',   bonuses: { stat_int: 2 },  desc: 'Seeker of histories.' },
    OUTLAW:    { name: 'Outlaw',    bonuses: { stat_mot: 2 },  desc: 'The predator.' },
    SCION:     { name: 'Scion',     bonuses: { all: 1 },       desc: 'Balanced master.' }
};

const STAT_MAPPING = {
    str: { name: 'Strength',     sub: ['Athletic', 'Survival', 'Immunity'] },
    mot: { name: 'Motoric',      sub: ['Initiative', 'Coordination', 'Stealth'] },
    men: { name: 'Menace',       sub: ['Intimidation', 'Racism', 'Sexism'] },
    int: { name: 'Intelligence', sub: ['Encyclopedia', 'Medicine', 'Logic'] },
    wis: { name: 'Wisdom',       sub: ['Insight', 'Inspiration', 'Intuition'] },
    cha: { name: 'Charisma',     sub: ['Deception', 'Persuasion', 'Empathy'] }
};

const RESOURCES = {
    GOLD:         { name: 'Balance',     emoji: ':coin:' },
    WEALTH:       { name: 'Wealth',      emoji: '⚖️' },
    EXOTICS:      { name: 'Exotics',     emoji: '🍷' },
    FOOD:         { name: 'Food',        emoji: '🥩' },
    ORES:         { name: 'Ores',        emoji: '⚒️' },
    VITALE:       { name: 'Vitale',      emoji: '💧' },
    METALLURGY:   { name: 'Metallurgy',  emoji: '🔩' }
};

// Sellesela (correct spelling) — previously misspelled as Cellesela/Cellesela
const FACTIONS = [
    'Atomic Guild', 'Caossa', 'Gaius', 'Outer Being', 'Rhagaia',
    'Sciatic League', 'Sellesela', 'The Fathers', 'The Mothers',
    'The Sisters', 'The Warlocks', 'Tyrannite'
];

// Maps stat shortcodes → DB column names
const STAT_KEYS = {
    str: 'attr_str', mot: 'attr_mot', men: 'attr_men',
    int: 'attr_int', wis: 'attr_wis', cha: 'attr_cha'
};

// ─── ARMY TYPES ────────────────────────────────────────────────────────────────
const ARMY_TYPES = {
    MILITIA:   { name: 'Militiamen',  emoji: '🧑', cost_balance: 20,  cost_met: 0,
                 food_per_unit: 1, requires: null,       field_mult: 0.6, siege_atk_mult: 0.5, siege_def_mult: 0.5, morale_penalty: true },
    SPEARMEN:  { name: 'Spearmen',   emoji: '🔱', cost_balance: 60,  cost_met: 0,
                 food_per_unit: 1, requires: 'BARRACKS', field_mult: 1.0, siege_atk_mult: 0.7, siege_def_mult: 1.0, anti_cavalry: true },
    SWORDSMAN: { name: 'Swordsman',  emoji: '⚔️', cost_balance: 100, cost_met: 0,
                 food_per_unit: 1, requires: 'BARRACKS', field_mult: 1.2, siege_atk_mult: 1.5, siege_def_mult: 0.8 },
    SHIELD:    { name: 'Shield Inf.', emoji: '🛡️', cost_balance: 80,  cost_met: 0,
                 food_per_unit: 1, requires: 'BARRACKS', field_mult: 0.9, siege_atk_mult: 0.8, siege_def_mult: 1.5, defensive: true },
    CAVALRY:   { name: 'Cavalry',    emoji: '🐎', cost_balance: 150, cost_met: 0,
                 food_per_unit: 2, requires: 'BARRACKS', field_mult: 1.5, siege_atk_mult: 0.8, siege_def_mult: 0.8 },
    RANGED:    { name: 'Ranged',     emoji: '🏹', cost_balance: 80,  cost_met: 0,
                 food_per_unit: 1, requires: 'BARRACKS', field_mult: 1.0, siege_atk_mult: 1.0, siege_def_mult: 1.2 },
    SIEGE:     { name: 'Siege',      emoji: '🪨', cost_balance: 500, cost_met: 5,
                 food_per_unit: 3, requires: 'CASTLE',  field_mult: 0.0, siege_atk_mult: 2.0, siege_def_mult: 0.5 }
};

const FORMATIONS = {
    SHIELD_WALL: { name: 'Shield Wall', type: 'defensive', preview: '🛡️⚔️🛡️⚔️🛡️\n⚔️🛡️⚔️🛡️⚔️', bonus: '+20% defense', atkMod: 0, defMod: 1.20, counter: 'WEDGE', counteredBy: 'FLANKING', reqUnit: 'mil_shield', reqName: 'Shield Infantry' },
    WEDGE:       { name: 'Wedge',       type: 'offensive', preview: '..⚔️..\n.⚔️⚔️.\n⚔️⚔️⚔️', bonus: '+15% attack', atkMod: 1.15, defMod: 1.0, counter: 'LINK', counteredBy: 'SHIELD_WALL' },
    LINE:        { name: 'Line',        type: 'balanced',  preview: '⚔️⚔️⚔️⚔️⚔️', bonus: '+10% vs Wedge', atkMod: 1.0, defMod: 1.0, counter: 'WEDGE', counteredBy: null },
    SCHILTRON:   { name: 'Schiltron',   type: 'anti-cav',  preview: '🔱⚔️🔱\n🛡️.🛡️\n🔱⚔️🔱', bonus: '+25% def vs Cavalry', atkMod: 1.0, defMod: 1.25, antiCav: true, counteredBy: null, reqUnit: 'mil_spearmen', reqName: 'Spearmen' },
    FLANKING:    { name: 'Flanking',    type: 'maneuver',  preview: '🐎⚔️⚔️⚔️⚔️🐎', bonus: '+15% atk, +20% Cav', atkMod: 1.15, defMod: 1.0, cavBonus: 1.20, counter: 'SHIELD_WALL', counteredBy: 'SCHILTRON', reqUnit: 'mil_cavalry', reqName: 'Cavalry' },
};

const MERC_DESC = 'Soldiers-for-hire drawn from various lands and backgrounds, bound by coin rather than loyalty. They fight effectively but disband at the end of each Imperial turn.';

const DUEL_STANCES = {
    HEAVY:   { name: 'Heavy Attack', emoji: '⚔️', beats: 'RIPOSTE', losesTo: 'QUICK', winMult: 2.0, lossMult: 0.5, tieMult: 1.0, desc: 'Powerful swing. Destroys Riposte.' },
    RIPOSTE: { name: 'Riposte',      emoji: '🛡️', beats: 'QUICK', losesTo: 'HEAVY', winMult: 1.0, lossMult: 0.7, tieMult: 1.0, desc: 'Calculated counter. Beats Quick Strike.' },
    QUICK:   { name: 'Quick Strike', emoji: '⚡', beats: 'HEAVY', losesTo: 'RIPOSTE', winMult: 1.5, lossMult: 0.5, tieMult: 1.0, desc: 'Fast lunge. Outspeeds Heavy Attack.' },
};

const DUEL_TERRAIN_MODS = {
    PLAINS:     { desc: 'Balanced', heavy: 0, defend: 0, quick: 0 },
    MOUNTAIN:   { desc: '+20% Defend block', heavy: 0, defend: 1.20, quick: 0 },
    FOREST:     { desc: '+15% Quick Strike dmg', heavy: 0, defend: 0, quick: 1.15 },
    HILLS:      { desc: '+15% Heavy Attack dmg', heavy: 1.15, defend: 0, quick: 0 },
    COASTAL:    { desc: '+2 CHA bonus', heavy: 0, defend: 0, quick: 0, chaBonus: 2 },
    RIVERLANDS: { desc: 'Balanced', heavy: 0, defend: 0, quick: 0 },
    SWAMP:      { desc: 'Both −2 MOT', heavy: 0, defend: 0, quick: 0, motPenalty: 2 },
};

module.exports = {
    EMOJIS,
    TERRAINS,
    TERRAIN_MULTIPLIERS,
    BUILDINGS,
    ANCESTRIES,
    GREAT_HOUSES,
    VITALE_FREE_HOUSES,
    PLAYER_RANKS,
    UPBRINGINGS,
    PROFESSIONS,
    STAT_MAPPING,
    RESOURCES,
    FACTIONS,
    STAT_KEYS,
    ARMY_TYPES,
    FORMATIONS,
    MERC_DESC,
    DUEL_STANCES,
    DUEL_TERRAIN_MODS
};
