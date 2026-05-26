# ATLAS — NationRP Discord Bot

> A fully self-contained NationRP engine for Discord, built on discord.js v14 and SQLite.
> Players build nations, raise armies, trade resources, engage in diplomacy, and wage war — all through interactive Discord slash commands.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Jahawk44/nationrp-bot
cd nationrp-bot
npm install

# 2. Configure environment
cp .env.example .env   # fill in TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID

# 3. Run
npm start              # production
npm run dev            # development (auto-restarts on file change)
```

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DISCORD_TOKEN` | Bot token from the [Discord Developer Portal](https://discord.com/developers) | ✅ |
| `CLIENT_ID` | Application (client) ID | ✅ |
| `GUILD_ID` | Server ID to register commands to | ✅ |
| `OWNER_ID` | Discord user ID of the server owner (bypass all access checks) | ✅ |

---

## Feature Overview

| Category | Commands / Features |
|---|---|
| **Character** | `/atlas begin` — Origins flow (Ancestry, Upbringing, Profession, free stat boosts, biography) |
| **Profile** | `/atlas profile` — Full character sheet with rank, Great House, stats, and treasury |
| **Economy** | `/atlas tax`, `/atlas balance`, `/atlas donate`, `/atlas gift` |
| **Trade** | `/atlas trade` — GUI-driven trade proposals and persistent trade routes |
| **Settlement** | `/atlas town` — Settle, build, upgrade, demolish, rename |
| **Population** | `/atlas population` — Commoners, nobles, Vitale demand, food deficit warnings |
| **Empire** | `/atlas empire` — Faction trade routes, Vitale market, Imperial throne status |
| **Diplomacy** | `/atlas relation` — Faction standing, bribe/gift factions, propose player treaties |
| **Military** | `/atlas military` — Recruit infantry/cavalry/ranged/siege/mercs, set formations |
| **Warfare** | `/atlas war battle`, `/atlas war siege`, `/atlas war raid` |
| **Colosseum** | `/atlas colosseum` — Player duels, terrain selection, stance system, betting |
| **Oracle** | `/atlas roll` — Stat-based or free-form dice rolls (d4–d100) |
| **Leaderboard** | `/atlas leaderboard` — Nation rankings across Economy, Defense, Offense, Prestige, Stability |
| **GM Tools** | `/atlas gm roll`, `/admin user edit/purge`, `/admin town edit/remove`, GM whitelist |
| **Scheduler** | Automated: weekly turns, daily population/military tick, hourly tax notifications |

---

## Project Structure

```
src/
├── index.js                    # Entry point — Discord client, IPv4 agent, error handlers
├── database.js                 # SQLite schema init (read-only — all migrations go in helpers.js)
├── scheduler.js                # node-cron jobs: weekly turn, daily tick, hourly notifier
│
├── commands/
│   ├── atlas.js                # Slash command definitions + top-level routing
│   ├── admin.js                # GM/admin slash commands
│   └── atlas/                  # Feature sub-modules (one file per system)
│       ├── action.js           # Scout, Oracle rolls
│       ├── battlename.js       # Battle name generator
│       ├── character.js        # Origins flow, profile
│       ├── colosseum.js        # Duel system
│       ├── diplomacy.js        # Relations, treaties, gifts
│       ├── economy.js          # Tax, balance, trade routes, faction trade
│       ├── events.js           # Rebellion / revolt event handlers
│       ├── leaderboard.js      # Nation score rankings
│       ├── military.js         # Army recruitment, formations, battle composition GUI
│       ├── town.js             # Settlement management
│       ├── trade.js            # Player-to-player trade proposals
│       ├── warfare.js          # Shared combat math + button/modal router  ← entry point
│       ├── warfare_battle.js   # Field battle lifecycle
│       ├── warfare_siege.js    # Siege lifecycle
│       └── warfare_raid.js     # Raid lifecycle
│
├── data/
│   └── constants.js            # All game constants (BUILDINGS, ANCESTRIES, FORMATIONS, etc.)
│
├── events/
│   ├── interactionCreate.js    # Central interaction router (buttons, selects, modals, autocomplete)
│   └── ready.js                # Bot ready event — avatar, command sync
│
└── utils/
    └── helpers.js              # Shared utilities: getMod, safeReply, ephemeralReply, initDB, etc.
```

---

## Architecture Notes

- **Database migrations** live exclusively in `helpers.js → initDB()`. Never add schema changes to `database.js`.
- **No business logic in `interactionCreate.js`** — it is a pure router. All logic belongs in the feature sub-module.
- **Ephemeral replies** in button/select handlers use `ephemeralReply()` from `helpers.js`, which calls `followUp` to avoid the "message deleted" UI artefact.
- **Parameterized queries only** — no string interpolation in SQL anywhere in the codebase.
- **File size limit: 350 lines** — split to `*_helpers.js` or a new sub-module if exceeded.
- **Discord API limits**: button `customId` ≤ 100 chars, embed description ≤ 4096 chars, select options ≤ 25, ActionRows per message ≤ 5.

---

## Key Reference Files

| Purpose | File |
|---|---|
| Game balance constants | [`src/data/constants.js`](src/data/constants.js) |
| AI development directives & lore | [`ai_instructions.md`](ai_instructions.md) |
| Changelog & patch notes | [`updates.md`](updates.md) |
| Feature roadmap | [`roadmap.md`](roadmap.md) |
