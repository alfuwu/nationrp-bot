---
name: ATLAS — NationRP Discord Bot
about: Full project implementation tracking for the Ares Heiliga League Discord bot
title: 'ATLAS — NationRP Discord Bot (Full Implementation)'
labels: ['project', 'bot', 'discord.js', 'nation-rp']
assignees: ''
---

## Overview

A fantasy nation-roleplay Discord bot — **ATLAS** — built on `discord.js` v14 with a SQLite-backed character/economy/diplomacy engine and Pathfinder-2e-flavored character sheets. Designed for the **Ares Heiliga League** set within the Styx Empire universe.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Framework | discord.js v14.25.1 |
| Database | SQLite (`sqlite3` + `sqlite`) |
| Scheduler | node-cron (weekly turn cycles) |
| Env | dotenv |

---

## Core Systems

### 1. Character & Origins
- Pathfinder 2e-inspired boost stack: Ancestry → Background → Profession → Free Boosts (4 points, max +2/stat)
- 6 attributes: STR, MOT, MEN, INT, WIS, CHA (base 10, soft cap 18)
- 12 ancestries across 5 Great Houses + independent cultures
- 3 player ranks: **Scion** (no town) → **Dominar** (town owner) → **Sovereign** (nation founder)
- Imperial Audit flow for GM approval of character sheets
- Biography modal (500 char max)

### 2. Economy
- Dual-currency: Personal Balance 🪙 + Polity Wealth ⚖️
- Dynamic tax with 24h cooldown + automatic DM notifications
- Building production/consumption on tax tick (Food, Ores, Metallurgy, Exotics)
- Terrain multipliers (Plains +20% Food, Coastal +20% Wealth, Mountain +50% Ores)
- Stability-scaling: ALL production scaled by `(rate_stab + 10) / 20`
- Servus risk/reward: +2%/unit production but -1 stability per 5 Servus
- Styx Empire Vitale Market with dynamic pricing: `50 × (1 + demandRatio × 4)`
- `/atlas donate` (Balance → Wealth at 1,000:1)
- `/atlas gift` (send any resource to another player)
- `/atlas trade` (one-time trade with Accept/Decline UI)

### 3. Population & Nobility
- Commoner growth: +1%/day (capped by `pop_cap = Σ(plots × 10) + building_bonuses`)
- Famine degrowth: -1%/day when food negative
- Noble auto-generation: 1 per 50 commoners
- Noble Vitale demand: 1 per 5 nobles/tick (unsatisfied = -2 Stab, -3 Prest)
- Servus Rebellion: fires at stab ≤ -5 (placeholder, awaiting warfare system)

### 4. Settlements & Infrastructure
- Multi-town management GUI (`/atlas town`)
- 1-hour real-time construction timers (`ready_at` milliseconds)
- Tiered building system with upgrade paths:
  - **Economy**: Farm → Livestock → Market
  - **Defense**: Palisade → Basic Wall → Advanced Wall
  - **Stability**: Tavern, Mothers Guild, Imperial Academy
  - **Military**: Barracks, Castle
  - **Production**: Mine → Deep Mine, Furnace → Smeltery, Exotic Workshop
- Founding stores: new towns receive +500 Food on settlement

### 5. Scouting & Intelligence
- Contest formula: `1d20 + Attacker Offense Score ≥ 10 + Target Defense Score`
- Full roll transparency (roll, bonuses, total vs DC on both success/failure)
- Scout autocomplete upgraded to suggest only target player's settlements
- Self-scouting blocked

### 6. Leaderboards
- 5 scoring dimensions: Economy, Defense, Stability, Prestige, Offense
- Building-based scoring (only completed buildings count)
- Paginated category UI with Prev/Next buttons
- Per-nation aggregate across all towns

### 7. Weekly Turn Cycle
- Monday 00:00 cron via node-cron
- Resets: `vitale_sold_week`, `mercs_temp`
- Posts turn announcement to `#main-hall`

---

## Current Status (v1.3.0)

### Completed

- [x] Bot initialization + slash command registration
- [x] SQLite schema with idempotent migrations
- [x] Character creation (full boost stack + free boosts + biography modal)
- [x] Economy loop (tax, production, consumption, stability scaling)
- [x] Population system (growth, nobles, servus)
- [x] Vitale market + dynamic pricing
- [x] Town management GUI (settle, build, upgrade, demolish)
- [x] Scouting + recruiting
- [x] Leaderboard system (5 categories, pagination)
- [x] Player rank system + Great House display
- [x] Metallurgy chain (Mine/Deep Mine → Furnace/Smeltery → Metallurgy)
- [x] Exotics production (Exotic Workshop)
- [x] Trade/donate/gift one-time systems
- [x] Weekly turn scheduler
- [x] Player dice roll GUI (ephemeral, player-locked)
- [x] Username persistence + autocomplete
- [x] Caossa ancestry bonuses (+30% Metallurgy, +20% Ore)

### In Progress / Not Started

- [ ] **GM Dashboard** — `/admin dashboard` with player overview (Ticket 7.1)
- [ ] **Vitale Embargo** — Block market access at Tyrannite ≤ -20 (Ticket 2.2)
- [ ] **Story Embed GUI** — GM narrative posts with dice rolls + player choices (Ticket 3.1)
- [ ] **Mercenaries + Town Rename** — Balance spending options (Ticket 8.1)
- [ ] **Automated Trade Routes** — Weekly recurring trades (NPC + player), treaty system (Ticket 4.1)
- [ ] **Diplomacy GUI** — Faction score bars, treaties, bribes, faction mechanics (Ticket 6.1)
- [ ] **Warfare System** — Field battle, siege, morale, rebellion resolution (Ticket 5.1)
- [ ] **GM Event Templates** — Famine, plague, raid, imperial favor, etc. (Ticket 3.2)
- [ ] **Codebase Refactoring** — Break `atlas.js` into domain-specific modules (roadmap.md)

### Known Bugs

| Bug | Status |
|---|---|
| `handleRelation` stub ("coming soon") | Replaced by diplomacy GUI (Ticket 6.1) |
| `handleTrade` modal flow incomplete | Replaced by trade routes (Ticket 4.1) |
| Atomic Guild negative-relation checks not implemented | Ticket 6.1, Task 7 |
| `stat_*` vs `attr_*` column drift in DB | Patched in helpers.js initDB migration |

---

## Deliverables

- [ ] All slash commands registered and functional
- [ ] Weekly automated turn cycle working
- [ ] All economic loops producing correct values
- [ ] Warfare system resolving battles correctly
- [ ] Diplomacy updating faction relations properly
- [ ] GM tools (dashboard, events, story embeds) operational
- [ ] Codebase modularized (`src/commands/atlas/` sub-modules)

---

## Project Structure

```
src/
  index.js                Entry point (IPv4 force, command registration)
  database.js             SQLite schema + idempotent ALTER TABLE migrations
  scheduler.js            node-cron weekly turn cycle (Mon 00:00)
  data/
    constants.js          Game data (buildings, terrains, ancestries, factions, stat mapping)
  utils/
    helpers.js            getMod, fmtMod, isGM, safeReply, resolveAtlasHQ, applyBoost, etc.
  commands/
    atlas.js              Player slash commands (~1900 lines — needs modularization)
    admin.js              GM / Imperial Audit protocols
  events/
    ready.js              Boot, avatar sync, command registration
    interactionCreate.js  Central routing (buttons, autocomplete, modal submit)
```

Target modular architecture (from roadmap.md):
```
src/commands/
  atlas.js                Main router (thin)
  atlas/
    character.js          Profile, origins flow
    economy.js            Tax, balance, donate, gift, trade, empire
    town.js               Settle, build, upgrade, demolish GUIs
    action.js             Scout, recruit
    diplomacy.js          Faction relations, treaties, bribes
    warfare.js            Field battle, siege, morale, rebellion
    trade.js              Automated trade routes
    story.js              GM story embeds
    events.js             GM event templates
```

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Bot token from Discord Developer Portal |
| `GUILD_ID` | Recommended | — | Guild for instant slash-command registration |
| `ADMIN_CHANNEL_ID` | Optional | Channel named `atlas-hq` | Imperial Audit notification channel |
| `OWNER_ID` | Optional | Historical owner ID | User ID bypassing all permission gates |
| `EMBARGO_THRESHOLD` | Optional | `-20` | Tyrannite relation threshold for Vitale embargo |

---

## Discord Hard Limits (for development)

| Limit | Value |
|---|---|
| Button customId | 100 chars max |
| Embed description | 4096 chars |
| Select menu options | 25 max |
| ActionRows per message | 5 max |
| Buttons per row | 5 max |
| Modal text input value | 4000 chars |

---

## Development Notes

- **IPv4 Force**: Bot uses custom `undici` agent with `dns.lookup` (family: 4) to resolve ECONNREFUSED issues
- **Safe Reply**: Always use `safeReply(interaction, ...)` instead of raw `interaction.reply()`
- **DB Operations**: Single UPDATE per handler, always parameterized — no string interpolation
- **Max File Size**: 350 lines per file — split to `*_helpers.js` if exceeding
- **No Business Logic in `interactionCreate.js`**: Routing only
- **DB Migrations**: Always add to `helpers.js initDB()` array, never to `database.js`

## References

- [`Claude_Roadmap.md`](./Claude_Roadmap.md) — Full implementation tickets with verbatim prompts
- [`roadmap.md`](./roadmap.md) — Strategic roadmap with AI model recommendations
- [`changelog.md`](./changelog.md) — Versioned release log (v1.0.3 → v1.3.0)
- [`update.md`](./update.md) — Feature map, file-by-file responsibilities, troubleshooting
- [`archive.md`](./archive.md) — Completed ticket archive
