# 📜 Atlas Updates & Logs

This file contains all merged update logs, changelogs, patch notes, and archived tickets for reference.

---

## [1.4.0] — 2026-05-26

### Fixed

- **Demolish Menu — Duplicate Option Values (`DiscordAPIError 50035`)**
  The Demolish dropdown in `/atlas town` crashed with `COMPONENT_OPTION_VALUE_DUPLICATED` whenever a
  town had more than one building of the same type (e.g., two Taverns). The select menu was using the
  building `type` string as the option `value`, which is not unique across rows. Fixed by using the
  building's database `id` as the option value. Duplicate types now also appear labelled as
  `Tavern #1`, `Tavern #2` etc. so players can distinguish them. Deletion now targets by `id` directly
  — no risk of accidentally removing the wrong building.

- **Warfare — Broken Guard Conditions**
  The automated ephemeral-reply migration script from v1.3.1 incorrectly stripped `if (condition)`
  guards from modal submit handlers in `warfare.js`, turning conditional error returns into
  unconditional ones. This caused every field battle, siege, and raid modal to immediately error
  out without processing. All guard conditions have been fully restored across the rewritten modules.

- **Tax Notification Race Condition**
  The midnight daily cron was unconditionally resetting `tax_notified = 0` for all players, which
  re-armed notifications mid-cooldown and caused the bot to ping players before their tax was actually
  ready. The reset is now removed from the midnight cron; `tax_notified` is only reset to `0` after a
  player successfully collects tax (handled in `economy.js`).

### Added

- **Servus in Sciatic League Faction Trade**
  `Servus (🔗)` is now available as both a give and receive resource in the Sciatic League faction
  trade route dropdown, consistent with all other factions.

- **Faction Trade Open Access (Embargo Gate)**
  Faction trade routes no longer require positive relations. Any player can initiate a trade route
  with any faction. However, if a player's relation score with a faction falls to **≤ −10 (Hostile)**,
  that faction will automatically embargo the player and block all trade until relations recover above
  that threshold.

- **`ephemeralReply` Helper — Full Adoption**
  The `ephemeralReply` helper (which uses `followUp` instead of `reply` on component interactions,
  preventing the "original message deleted" artefact) has been applied to every button, select, and
  modal handler across all feature modules: `action.js`, `colosseum.js`, `military.js`, `warfare.js`,
  `economy.js`, `diplomacy.js`, `trade.js`.

### Changed

- **`warfare.js` Modularized into Three Sub-modules**
  The monolithic `warfare.js` (1041 lines) has been split into focused, maintainable files:

  | File | Responsibility | ~Lines |
  |---|---|---|
  | [`warfare.js`](src/commands/atlas/warfare.js) | Shared constants, combat math (`calcArmyPower`, `calcOffenseScore`, etc.), button/modal router, `handleRebellionEvent` | ~230 |
  | [`warfare_battle.js`](src/commands/atlas/warfare_battle.js) | Field battle lifecycle — initiation → composition modal → GM naming → defender commit → resolution → substat reward | ~320 |
  | [`warfare_siege.js`](src/commands/atlas/warfare_siege.js) | Siege lifecycle — initiation → GM confirmation → resolution → building destruction | ~190 |
  | [`warfare_raid.js`](src/commands/atlas/warfare_raid.js) | Raid lifecycle — initiation → GM approval → Phase 1 combat → player withdraw/press decision → Phase 2 resolution → loot | ~220 |

  Public API is unchanged — `interactionCreate.js` and `atlas.js` continue to `require('./warfare')`
  and call the same exported functions. Sub-modules are lazy-loaded to prevent circular require issues.

- **`README.md` Rewritten**
  The placeholder README (7 lines) has been replaced with a full professional document covering:
  quick start, environment variable table, complete feature overview table, annotated project
  structure tree, and architecture rules (migration policy, ephemeral reply convention, SQL safety
  rules, file-size limit, Discord API limits).

### Balance

- **Population Growth — Rates Reduced for Medieval Realism**
  The previous growth rates caused a starting town of 100 commoners to exceed 1,300 in 30 days,
  which was unrealistic even for a compressed game-time setting. All growth tiers reduced:

  | Tier | Condition | Old rate | New rate |
  |---|---|---|---|
  | Abundant | food ≥ 1,000 | +2.0%/day | **+0.5%/day** |
  | Comfortable | food ≥ 200 | +1.5%/day | **+0.3%/day** |
  | Subsisting | food > 0 | +1.0%/day | **+0.15%/day** |
  | Famine | food ≤ 0 | −1.0%/day | −1.0%/day *(unchanged)* |

  At the new abundant rate, a town of 100 reaches ~200 in ~140 days — far more consistent with
  a medieval nation-building timeline.

- **Tavern — Food Cost Removed**
  Tavern had `food_cost: 100/day` — identical to a fully garrisoned Castle. A drinking
  establishment drawing the same ration supply as a military fortress made no logical sense.
  Food cost set to `0`. Tavern remains a pure wealth generator (`+30 ⚖️/day`).

---

## 📁 Source: changelog.md

# 📜 Atlas Bot Changelog

## [1.3.0] - 2026-05-12
### Added
- **Player Rank System**: Three ranks — `SCION` (no town), `DOMINAR` (town owner), `SOVEREIGN` (nation founder). Drives Vitale logic and gameplay gates.
- **Great House System**: All 12 ancestries now carry a `house` field (Tyrannite, Rhagaia, Sellesela, Gaius, Caossa, Independent, Sciatic League, Colonia Free Tribe). Profile now shows House affiliation.
- **Tora Ancestry**: Added to character creation with lore placeholder.
- **New Buildings**: Mine ⛏️, Deep Mine 🪨, Furnace 🔥, Smeltery ⚙️, Exotic Workshop 🍷 added to BUILDINGS constants.
- **Metallurgy Resource**: `🔩 Metallurgy` now produced by Furnace/Smeltery, shown in Treasury. Caossa-ancestry players receive +30% Metallurgy bonus and +20% Ore bonus.
- **Exotics Production**: Exotic Workshop now produces Exotics passively on tax tick.
- **Ore Consumption**: Furnace/Smeltery consume Ores during tax (ore net can go negative if supply < consumption — shown in report).
- **Username Persistence**: Username saved to DB on every slash command; autocomplete now shows Character Name (username) for all player lookups.
- **Merc Temp Wipe**: `mercs_temp` reset to 0 on weekly turn cron (Ticket 8.1 prep).

### Changed
- **Turn Notification Channel**: Weekly turn announcement now posts to `#main-hall` (`1502560573710270555`) instead of `#atlas-hq`.
- **Faction Corrections**: `Gagoon` renamed to `Caossa`, `Sellesela` corrected from earlier misspelling across all files.
- **Roll GUI**: `/atlas roll` is now ephemeral. Results are posted publicly to the channel. Only the player who opened the Oracle can interact with it.
- **Profile Redesign**: `/atlas profile` no longer shows LVL, XP, AC, HP. Now shows Rank, Great House (with color), Character Name, Ancestry/Upbringing/Profession line, and Description.
- **Audit Embed**: Character creation audit in atlas-hq now shows Ancestry, Great House, Upbringing, Profession — no AC/HP.
- **Vitale Logic**: Sovereigns pay Vitale; Scions and Dominars see it as informational (subsidized by Imperial Academy).

### Fixed
- **Leaderboard Button Crash**: Added `deferUpdate()` before leaderboard category button handler. No more interaction timeout.
- **Username Autocomplete**: User autocomplete now shows `CharacterName (discordUsername)` instead of raw ID.
- **Roll GUI Player Lock**: Non-owning players can no longer click another player's Roll Oracle buttons.

### Removed
- **Akha Ancestry**: Removed from character creation (lore unconfirmed per roadmap Q4).
- **LVL / XP / AC / HP from UI**: Removed from profile display and character creation flow. Columns retained in DB (no data loss). Per roadmap: "Do not add XP, levels, or AC — this is a choice-driven nation game."


### Added
- **Town GUI Back Buttons**: Settle and Build/Upgrade/Demolish empty states now feature "Back" buttons to prevent players getting stuck in dead-end menus.
- **Subsidized Vitale Display**: `/atlas tax` and `/atlas population` now clearly show "Subsidized" Vitale demand for players without a nation, explicitly indicating they face no penalty while their overlord provides it.
- **Scout Autocomplete Upgrade**: `/atlas action scout` now requires targeting a `user` first, allowing the `town` autocomplete to intelligently suggest only that specific player's settlements.

## [1.2.0] - 2026-05-10
### Added
- **Advanced Economic Simulation**: Buildings now produce and consume Food/Ores each tax tick. Terrain multipliers applied (Plains +20% Food, Coastal +20% Wealth, Mountain +50% Ores, etc.).
- **Stability Economy Link**: ALL production (wealth, food, ores) now scaled by `stabilityMultiplier = (rate_stab + 10) / 20`. Low stability cripples your economy.
- **Servus Mechanics**: Owning Servus gives unlimited +2%/unit production bonus but drains -1 `rate_stab` per 5 Servus owned. At -5 stability, Servus Rebellion can fire.
- **Servus Rebellion**: Catastrophic event placeholder — all Servus lost, wealth and pop damaged. "Deploy Military" button placeholder for future Warfare system.
- **Noble Revolt**: Catastrophic event placeholder — dissatisfied nobles cause player's own soldiers to defect. "Call for Loyalty" placeholder button.
- **Population System**: Commoner population grows at 1%/day (capped by `pop_cap`). Famine triggers -1%/day degrowth. Nobles auto-generated at 1 per 50 commoners.
- **Noble Vitale Demand**: Nobles consume Vitale each tax tick. Satisfied nobles give +2 Prestige. Unsatisfied nobles give -2 Stability, -3 Prestige.
- **Vitale Market**: `/atlas empire` now shows a live Styx Empire Vitale Market with dynamic pricing based on weekly demand. Pool = `vitale_base + (10 × players)`.
- **`/atlas population`**: New command showing full population breakdown, noble status, food demand, servus effects, and rebellion risk alerts.
- **`/atlas recruit`**: New command to conscript soldiers from commoner population (requires Barracks, max 10% of pop, 50🪙 per soldier).
- **Founding Stores**: New towns receive +500 🥩 Food on settlement. First town also displays a farm-building tip.
- **Barracks/Castle/Palace Stability Bonus**: Building military structures now permanently applies +2/+4/+6 `rate_stab` respectively.
- **Split Tax Display**: `/atlas tax` now returns two embeds: **Economic Report** and **Population Report**, with embedded warning alerts.
- **Negative Score Cascades**: All `rate_*` columns floored at -10 with cascading consequences documented in roadmap.
### Changed
- **BUILDINGS constants**: All buildings now have `food_prod`, `food_cost`, `ore_prod`, `pop_cap_bonus`, and `stab_bonus` fields.
- **Scheduler**: Monday weekly cron now also resets `vitale_sold_week` to 0.

## [1.1.6] - 2026-05-09
### Added
- **GUI Trade System**: Completely overhauled the `/atlas trade` system into a UI-driven dashboard, replacing raw slash command arguments with interactive dropdown menus and modals.
- **Tax Notifications**: The bot now automatically DMs users when their 24-hour tax cooldown is up, pinging them in the channel where they last collected taxes.

## [1.1.5] - 2026-05-09
### Added
- **Servus Resource**: Introduced the `Servus` resource (`🔗`) into the economy database.
- **Trade System**: `/atlas trade` allows proposing trades to other players with an interactive Accept/Decline UI.
- **Gift System**: `/atlas gift` allows directly sending resources (Balance, Food, Ores, Vitale, Exotics, Servus) to other players.
- **Donate Command**: Renamed `/atlas convert` to `/atlas donate`.
- **Custom Emojis**: Updated emojis for Vitale (`💧`), Exotics (`🍷`), and Ores (`⚒️`).

## [1.1.4] - 2026-05-09
### Added
- **Economy Overhaul**: Fully transitioned to a dual-currency system (Personal Balance 🪙 and Polity Wealth ⚖️).
- **Wealth Conversion**: `/atlas convert` command added to exchange Balance for Wealth at a 1,000:1 ratio.
- **Nation Founding**: New `/atlas nation found` command requires 100,000 Wealth to establish a nation.
- **Dynamic Tax System**: `/atlas tax` now grants a static 100 🪙 per use, while Wealth accumulates over real-world time (24h cycles) based on settlement infrastructure.

### Changed
- **Building Costs**: All town structures are now priced in Wealth (⚖️) instead of Balance.
- **Command Progression**: Uninitiated players are locked to `/atlas begin`. Players must settle a town before accessing other town commands, and must found a nation before accessing empire commands.
- **Profile UI**: `/atlas profile` Treasury section updated with new currency symbols. Bio length limit increased to prevent cutoff.
- **Balance UI**: `/atlas balance` now displays all resources (Food, Ores, Vitale, Exotics).

### Fixed
- **Leaderboard Crash**: Fixed a UI rendering issue where categories exceeded Discord's 5-button limit per ActionRow.
- **Tax Accumulation**: Fixed a bug where first-time taxpayers received ~20,000 days of retroactive wealth due to Unix epoch calculation.


## [1.1.3] - 2026-05-07
### Added
- **Age System**: Lineages now have an Age attribute, determined at the start of `/atlas begin` by rolling `1d10 + 10`.
- **GM Biography Control**: Added `Biography` (description) field to `/admin user edit`, allowing GMs to write custom lore for players.
- **Age Editing**: GMs can now manually adjust player age via `/admin user edit`.

### Removed
- **Leveling System**: Removed all references to LVL and XP from profiles and character creation as they are no longer used in the current game model.
- **Level Display**: Removed LVL and XP counters from the `/atlas profile` interface.

## [1.1.1] - 2026-05-06
### Changed
- **Advanced Scouting Mechanic**: `/atlas town scout` completely overhauled per roadmap §📡.
    - **Old formula** (broken): `DC = 10 + target's max plots` — made scouting mathematically impossible against large towns.
    - **New formula**: `(1d20 + Attacker Offense Score) >= (10 + Target Defense Score)`
    - **Offense Score**: Reuses the same scoring engine from the leaderboard (Barracks +1, Castle +2, Palace +3 per nation).
    - **Defense Score**: Reuses the defense score (Palisade +1, Wall +2, Adv. Wall +3, Castle +5 per town).
    - **Roll transparency**: Players now see the full breakdown — roll, offense bonus, total vs DC — on both success and failure.
    - **Success output**: Shows all target town profiles with named buildings, tiers, and construction status.
    - **Failure output**: Spies captured message now includes the roll result and a reminder to build military.
    - Self-scouting is now blocked with a clear error message.

## [1.1.0] - 2026-05-06
### Added
- **Complex Leaderboard & Scoring System**: `/atlas leaderboard [category]` — fully functional nation score rankings.
    - **Scoring Engine** (`calculateNationScore`): Calculates per-nation scores across 5 dimensions based solely on completed buildings.
    - **Economy** (Farm +1, Livestock +2, Market +3) — stackable across all towns.
    - **Defense** (Palisade +1, Basic Wall +2, Advanced Wall +3, Castle +5/town) — per-town castle cap enforced.
    - **Stability** (Tavern +1/town, Castle +5/town, Palace +15 nation-wide) — all caps enforced.
    - **Prestige** (Mothers Guild +3/town, Imperial Academy +8 nation-wide) — caps enforced.
    - **Offense** (Barracks +1, Castle +2, Palace +3) — stackable across towns.
    - **Total Score**: Sum of all 5 dimensions for overall ranking.
    - **Interactive UI**: 6 category buttons (Total, Economy, Defense, Stability, Prestige, Offense) and pagination with Prev/Next.
    - Only completed buildings count (construction-in-progress are excluded).
- Trade & Knowledge dimensions reserved as WIP per roadmap.

## [1.0.9] - 2026-05-06
### Added
- **Private Scout Profiles**: `/atlas town scout` now generates detailed settlement reports (Terrain, Plots, Building inventory) for the scout instead of a simple name list. The interaction is now ephemeral. `[src/commands/atlas.js:handleScout]`
- **User Dice Rolls**: `/atlas roll` added for players. Allows rolling based on character attributes or manual dice types (d4-d100). `[src/commands/atlas.js:handleUserRoll]`
- **Whitelist Directory**: `/admin system whitelist action:list` now displays all whitelisted Game Masters and their IDs. `[src/commands/admin.js:execute]`
- **Construction Info**: `/atlas town list` now displays the specific building name being constructed next to its timer (e.g., "Farm 🚧"). `[src/commands/atlas.js:handleTownList]`
- **Roadmap Overhaul**: `roadmap.md` rewritten to categorize tasks by complexity and assign recommended AI models (Claude 3.5 Sonnet for complex logic).

### Fixed
- **Building Upgrade Integrity**: Upgrades now require the base building to be finished construction first. `[src/commands/atlas.js:handleTownUpgrade]`
- **Building Replacement Logic**: Upgrades now target and replace exactly ONE instance of the base building instead of deleting all buildings of that type in the town. `[src/commands/atlas.js:handleButton]`
- **Construction Previews**: `/atlas town build` and `/atlas town upgrade` now display the building Category and specific Benefits (description) in the confirmation embed. `[src/commands/atlas.js:handleTownBuild, handleTownUpgrade]`

## [1.0.8] - 2026-05-06
### Added
- **RPG Character Sheet**: Complete overhaul of character creation on a Pathfinder 2e boost foundation. All six attributes start at 10, Ancestry / Background / Profession bonuses now actually apply, plus a new **Free Boost Distributor** stage (4 free +1 points, max +2 per stat) and a Discord modal for biography. `[src/commands/atlas.js:buildFreeBoostView, commitFinalCharacter]`
- **Sheet Fields**: New `level`, `xp`, `hp_max`, `hp_current`, `ac`, `description` columns on `users`. HP = 8 + STR mod at level 1, AC = 10 + MOT mod. `[src/database.js]`
- **Profile Dashboard (sheet style)**: Rebuilt `/atlas profile` embed to match the canonical character sheet image — AC/LVL/HP/XP header, identity row, six stat blocks with three sub-stat modifiers each, treasury footer. `[src/commands/atlas.js:handleProfile]`
- **Helpers Module**: Centralized `getMod`, `fmtMod`, `isGM`, `isOwner`, `resolveAtlasHQ`, `applyBoost`, `buildBaseAttributes`, `deriveSheetFromStats` to kill duplication across `atlas.js` / `admin.js`. `[src/utils/helpers.js]`
- **Modal Pipeline**: `interactionCreate.js` now dispatches `ModalSubmit` events; `atlas.js` exports `handleModal` consumed by the new `originsmodal_*` flow. `[src/events/interactionCreate.js, src/commands/atlas.js]`
- **Admin Settlement Autocomplete**: `/admin town edit` and `/admin town remove` now autocomplete by `name #id — owner` instead of requiring a raw integer. `[src/commands/admin.js, src/events/interactionCreate.js]`

### Fixed
- **Negative Modifier Bug**: Origins finalization now actually applies Ancestry/Background/Profession bonuses to `attr_*`. Previously the chosen origin only saved as strings, leaving every character at 8/8/8/8/10/10 (-1 across the board). `[src/commands/atlas.js:commitFinalCharacter]`
- **Submission Lock (re-implemented)**: Pending-status guard refuses duplicate audit submissions and stops re-pinging atlas-hq. `[src/commands/atlas.js:commitFinalCharacter]`
- **Origin Buttons Lock**: Buttons collapse to a confirmation embed on FINALIZE so a player can no longer double-click into duplicate audits. `[src/commands/atlas.js:commitFinalCharacter]`
- **Scout Null-Guard**: `/atlas town scout` now responds gracefully when the caller or target has no lineage. `[src/commands/atlas.js:handleScout]`
- **Sciatic Trade Reference**: Removed dangling `handleSciaticTrade` row from `update.md` (the command was never implemented).
- **Profession Bonuses Visibility**: Profession confirm embed now lists bonuses for parity with Ancestry/Background. `[src/commands/atlas.js:handleOriginsLogic]`

### Changed
- **Menace Sub-Stats**: `STAT_MAPPING.men.sub` is now `['Intimidation', 'Racism', 'Sexism']` to match the canonical character sheet image. `[src/data/constants.js]`
- **Owner ID**: Centralized in `helpers.js`, now reads `process.env.OWNER_ID` with the historical ID as fallback. `[src/utils/helpers.js, src/commands/admin.js, src/commands/atlas.js]`
- **Default Stats**: Fresh `users` rows now default `attr_*` to 10 instead of the old 8/10 split.
- **README**: Replaced the one-line file with run instructions, env-var table, project layout, and a character-system overview.

## [1.0.7] - 2026-05-05
### Added
- **Styx Throne Dashboard**: Implemented `/atlas empire` to display Imperial status, current ruler, and turn cycle. `[src/commands/atlas.js]`
- **Smart Infrastructure**: Refactored `BUILDINGS` into tiered categories (Economy, Defense, Stability, Military) with upgrade paths. `[src/data/constants.js]`
- **Tiered Autocomplete**: The upgrade system now intelligently filters structures based on a town's existing inventory. `[src/events/interactionCreate.js]`
- **Generic Dice Rolls**: Added `type` option to `/atlas gm roll` for d4-d100 rolls. `[src/commands/atlas.js]`

### Fixed
- **Interaction Race Conditions**: Standardized response methods to resolve "InteractionAlreadyReplied" and "Unknown Interaction" errors. `[src/commands/atlas.js]`
- **Real-Time Construction**: Scaled building times to 1-hour (IRL time) with live countdown timestamps. `[src/commands/atlas.js]`
- **Notification Centralization**: Routed all lineage submissions and admin approvals to the `atlas-hq` channel. `[src/commands/atlas.js]`

## [1.0.6] - 2026-05-05
### Added
- **Automated Turn Scheduler**: Integrated `node-cron` to automatically advance the Imperial Turn every Monday at 00:00. Includes automated admin notifications. `[src/scheduler.js]`
- **Strategic Roadmap**: Created `roadmap.md` to track planned features like leaderboards and character stat revamps.

### Fixed
- **Submission Reliability**: Character creation buttons now disable immediately upon submission to prevent duplicate staff notifications.
### Added
- **Profile Dashboard UI**: Redesigned the `/atlas profile` embed into a clean, grouped dashboard layout with symmetric fields and code-block formatting. `[src/commands/atlas.js]`
- **Context-Aware Autocomplete**: Implemented dynamic suggestions for the "Value" field in admin commands based on the selected "Field" (e.g., suggesting Ancestries only when editing Ancestry). `[src/events/interactionCreate.js]`
- **Resource Autocomplete**: Added autocomplete for trade resources to prevent typos and invalid trade proposals. `[src/events/interactionCreate.js]`
- **Faction Integration**: Added a complete list of 12 world factions (Atomic Guild, Sciatic League, etc.) to the diplomatic system. `[src/data/constants.js]`

### Fixed
- **Duplicate Audit Requests**: Implemented a "submission lock" in the Origins protocol. The system now checks for existing pending status to prevent multiple approval requests from a single player. `[src/commands/atlas.js]`
- **Faction Autocomplete**: Enabled autocomplete for the `/admin relation set` command, allowing GMs to select from valid factions instantly. `[src/events/interactionCreate.js]`
- **Purge Protocol**: Resolved a critical "System Error" when confirming user purges. Corrected `EmbedBuilder` implementation and added recursive deletion for buildings and relations. `[src/events/interactionCreate.js]`
- **Command Intuition**: Replaced blank text fields with predefined selection menus for administrative edits. `[src/commands/admin.js]`

## [1.0.4] - 2026-05-05
### Added
- **GM Whitelist System**: New database table and admin commands to manage Game Master access independently of Discord roles. `[src/commands/admin.js]`
- **Animated Avatar**: Switched to high-quality animated GIF for bot branding. `[src/events/ready.js]`
- **NationRP Metadata**: Added `exotics`, `fertility`, and `ready_at` tracking to support deeper game mechanics. `[src/database.js]`

### Fixed
- **Interaction Timeouts**: Unified `deferReply()` logic across all commands to prevent "The application did not respond" errors. `[src/commands/atlas.js]`
- **Duplicate Commands**: Fixed ghost command registration by clearing global protocols and prioritizing guild synchronization. `[src/events/ready.js]`
- **Profile UI**: Merged character attributes (Strength, Motoric, etc.) with legacy info (Nation, Towns) into a single, comprehensive embed. `[src/commands/atlas.js]`

### Security
- **Owner Override**: Hardcoded server owner override for ID `317883862258548737`, ensuring access to Imperial protocols regardless of role assignments.

## [1.0.3] - 2026-05-05 (Initial Modularization)
### Added
- **Modular Architecture**: Split monolithic `index.js` into dedicated command and event directories.
- **Automatic Sync**: Commands now automatically synchronize with Discord on startup.
- **Imperial Origins**: Refactored character creation flow with improved persistence.


---

## 📁 Source: update.md

# ATLAS | Imperial Interface - Update Log

This file tracks the evolution of the NationRP Discord Bot (ATLAS). Use this as a reference for existing features, database schemas, and code locations to ensure consistent development and easier troubleshooting.

## 📍 System Architecture & Core
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Bot Init** | Client setup, intents (Guilds, Messages, Members), and IPv4 force agent. | `[src/index.js:L14-L18]` |
| **Command Sync** | Dynamic registration of slash commands to a specific Guild. | `[src/index.js:L156:register]` |
| **Database setup** | SQLite initialization with tables for users, towns, buildings, and events. | `[src/database.js:L5:setupDatabase]` |
| **Error Handling** | Global handlers for `unhandledRejection` and `uncaughtException`. | `[src/index.js:L22-L23]` |

---

## 🎭 Character & Origins System (RPG, v1.0.8)
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Origins Flow** | Multi-step interactive setup (Roll Age -> Ancestry -> Background -> Profession -> Free Boosts -> Description Modal). | `[src/commands/atlas.js:handleOriginsIntro]` |
| **Logic Handler** | Processes button interactions for character creation stages including `ageroll`, `fbadd`, `fbreset`, `fbfinalize`. | `[src/commands/atlas.js:handleOriginsLogic]` |
| **Free Boost Distributor** | 4 free +1 points (max +2 per stat) applied on top of Ancestry/Background/Profession bonuses. Live embed with RESET / FINALIZE / BACK. | `[src/commands/atlas.js:buildFreeBoostView]` |
| **Description Modal** | Discord modal (`originsmodal_*`) captures up to 500 chars of biography on FINALIZE. | `[src/commands/atlas.js:handleButton, handleModal]` |
| **Stat Engine** | Pathfinder 2e adapted: base 10 across all stats, additive flat bonuses, soft cap at 18. | `[src/utils/helpers.js:buildBaseAttributes, applyBoost]` |
| **Sheet Derivation** | HP and AC computed from stats: `HP = 8 + STR mod`, `AC = 10 + MOT mod`. | `[src/utils/helpers.js:deriveSheetFromStats]` |
| **Submission Lock** | Pending-status guard prevents duplicate audits; success embed disables prior controls. | `[src/commands/atlas.js:commitFinalCharacter]` |
| **Imperial Audit** | Audit embed posted to atlas-hq via `resolveAtlasHQ` helper. Includes derived AC/HP/Age summary and biography. | `[src/commands/atlas.js:commitFinalCharacter]` |
| **Profile (sheet-style)** | Image-aligned dashboard: AC / Age / HP header, identity row (Ancestry/Background/Profession), six stat blocks with three sub-stat modifiers each, Treasury footer. | `[src/commands/atlas.js:handleProfile]` |

---

## 💰 Economy & Trade Protocols
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Daily Tax** | `/atlas tax` - Grants a static stipend (100 🪙) and accumulates Wealth (⚖️) based on real-time days passed since last tax. The bot will automatically notify you when 24h have passed. | `[src/commands/atlas.js:handleTax]` |
| **Balance** | `/atlas balance` - Displays personal Balance (🪙), national Wealth (⚖️), and all resources. | `[src/commands/atlas.js:handleBalance]` |
| **Donate**| `/atlas donate` - Exchanges Personal Balance into Polity Wealth at a 1,000:1 ratio. | `[src/commands/atlas.js:handleDonate]` |
| **Gift**| `/atlas gift` - Sends an amount of any resource to another player. | `[src/commands/atlas.js:handleGift]` |
| **Trade**| `/atlas trade` - Opens an interactive Trade Dashboard GUI to build a proposal for another player. | `[src/commands/atlas.js:handleTrade]` |
| **Found Nation**| `/atlas nation found` - Creates a nation for 100,000 ⚖️. | `[src/commands/atlas.js:handleNationFound]` |

---

## 🏘️ Settlement & Infrastructure
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Town Management GUI**| `/atlas town` - Single interactive dashboard for all settlements. Features dropdown selection. | `[src/commands/atlas.js:handleTownGUI]` |
| **Settle** | Settle New Town via the `/atlas town` dashboard modal. | `[src/commands/atlas.js:handleModal]` |
| **Construction** | Build via the `/atlas town` GUI dropdowns with 1h timers. | `[src/commands/atlas.js:handleSelect]` |
| **Upgrades** | Upgrade via the `/atlas town` GUI. | `[src/commands/atlas.js:handleSelect]` |
| **Demolish** | Demolish structures via the `/atlas town` GUI for a 50% refund. | `[src/commands/atlas.js:handleSelect]` |

---

## ⚖️ Diplomacy & Intelligence
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Scouting** | `/atlas action scout` - Skill check to gather intel on targets. Requires User and Town. | `[src/commands/atlas.js:handleScout]` |
| **Recruiting** | `/atlas action recruit` - Conscript soldiers from commoners using Barracks. | `[src/commands/atlas.js:handleRecruit]` |
| **Dice Rolls** | `/atlas roll` - Player dice rolls based on stats or manual types (d4-d100). | `[src/commands/atlas.js:handleUserRoll]` |
| **Diplomacy** | `/atlas relation` - Visual standing bar for various factions. | `[src/commands/atlas.js:handleRelation]` |
| **Empire Status** | `/atlas empire` - Shows the current ruler and turn number. | `[src/commands/atlas.js:handleEmpire]` |
| **Strategic Roadmap** | Future complex features and model recommendations. | `[roadmap.md]` |

---

## 🛠️ Admin & GM Protocols
| Feature | Description | Location Tags |
| :--- | :--- | :--- |
| **Oracle Rolls** | `/atlas gm roll` - GM-triggered skill checks for players. Now with dice types. | `[src/commands/atlas.js:handleGMRoll]` |
| **Whitelist Directory**| `/admin system whitelist action:list` - View all whitelisted GMs. | `[src/commands/admin.js:execute]` |
| **Imperial Audit** | Dedicated `/admin` command, restricted by `Administrator` permission. | `[src/commands/admin.js:execute]` |

---

## 📦 Database Schema (Reference)
| Table | Fields |
| :--- | :--- |
| **users** | `id, balance, wealth, food_surplus, ores, vitale, pop_*, attr_* (default 10), age, hp_max, hp_current, ac, description, status, ancestry, upbringing, profession, etc.` |
| **towns** | `id, user_id, name, terrain_type, plots_total, fertility` |
| **buildings** | `id, town_id, type, level, ready_at` |
| **relations**| `user_id, faction_name, score` |
| **gm_whitelist** | `user_id` |
| **global_settings** | `key, value` (e.g. `current_turn`, `empire_ruler`) |

---

## 📝 Troubleshooting Notes
- **IPv4 Force**: The bot uses a custom `undici` agent with `dns.lookup` (family: 4) to force IPv4. This resolves `ECONNREFUSED` issues on systems where `dns.resolve4` is restricted while still preventing connection timeouts. `[src/index.js:L8]`
- **Construction Timers**: Uses `ready_at` (milliseconds) in the DB to track building completion. `[src/commands/atlas.js:L95]`
- **Autocomplete**: Town and Building selection in slash commands use database-backed autocompletion. `[src/events/interactionCreate.js:L9]`

## 🗂️ System Architecture & File Locations
To ensure easy troubleshooting and scalability, the bot's architecture has been modularized into the following structure:

### `src/data/` (Static Constants)
- `[src/data/constants.js]` - Contains all hardcoded game data (Terrains, Buildings, Ancestries, Backgrounds (Upbringings), Professions, Emojis, and Stat Mapping). Edit this file to rebalance game stats. Sub-stats follow the canonical character sheet image (Menace: Intimidation/Racism/Sexism).

### `src/utils/` (Shared Helpers)
- `[src/utils/helpers.js]` - `getMod`, `fmtMod`, `isOwner`, `isGM`, `resolveAtlasHQ`, `applyBoost` (PF2e-style soft cap at 18), `buildBaseAttributes`, `deriveSheetFromStats`. Single source of truth for character math and authorization checks.

### `src/commands/` (Slash Commands)
- `[src/commands/admin.js]` - Imperial Audit protocols. Handles user editing, purging, settlement edit/remove (now with town autocomplete), and the **GM Whitelist** system.
- `[src/commands/atlas.js]` - Core player interface. Handles **Profile UI**, Tax, Towns, **GM Oracle (Rolls)**, and the full Origins flow including the Free Boost stage and Description Modal.

### `src/events/` (Event Handlers)
- `[src/events/ready.js]` - System initialization, **Avatar Management**, and Guild Protocol (Command) sync.
- `[src/events/interactionCreate.js]` - Central routing for all interactions: Button logic, Autocomplete, and **Modal Submit** dispatch.

### Core Engine
- `[src/index.js]` - Entry point and Environment injector.
- `[src/database.js]` - SQLite schema manager, migrations (including the 1.0.8 RPG sheet columns), and table initialization.

---

## 🛠️ Feature Map & Script Locations
| Feature | Location | Logic Handler |
| :--- | :--- | :--- |
| **GM Whitelist** | `[src/commands/admin.js]` | `handleWhitelist` |
| **Profile UI** | `[src/commands/atlas.js]` | `handleProfile` (Dashboard Layout) |
| **User Purge** | `[src/events/interactionCreate.js]` | Recursive deletion (DB Cleanup) |
| **Value Autocomplete** | `[src/events/interactionCreate.js]` | Context-aware suggestions |
| **Faction Relations** | `[src/data/constants.js]` | Faction list |
| **Turn System** | `[src/scheduler.js]` | Weekly Automation (Mon 00:00) |
| **Styx Throne** | `[src/commands/atlas.js]` | `handleEmpire` |
| **Town Management** | `[src/commands/atlas.js]` | `handleTownList`, `handleTownBuild` |
| **Imperial Audit** | `[src/commands/atlas.js]` | `handleOriginsIntro`, `handleOriginsLogic`, `commitFinalCharacter` |
| **Free Boost Modal** | `[src/commands/atlas.js]` | `buildFreeBoostView`, `handleModal` |
| **Character Math** | `[src/utils/helpers.js]` | `buildBaseAttributes`, `deriveSheetFromStats`, `applyBoost` |


---

## 📁 Source: PATCH_NOTES.md

# ATLAS Patch Notes — Balance & Bug Fix Pass

## Files changed

| File | Status |
|------|--------|
| `src/utils/helpers.js` | Rewritten |
| `src/commands/atlas/economy.js` | Rewritten |
| `src/commands/atlas/action.js` | Rewritten |
| `src/scheduler.js` | Rewritten |

---

## Critical bug fixes

### 1. Duplicate stat columns (attr_* vs stat_*)
**Problem:** The DB had both `attr_str/mot/men/int/wis/cha` (new) and `stat_str/mot/men/int/wis/cha` (old, stuck at 8/8/8/8/10/10). Character creation was writing to `attr_*` correctly, but the `stat_*` columns were never removed, causing confusion in any code that read the wrong set.

**Fix (helpers.js → `initDB`):** On boot, any user row where `attr_*` is still at the new default (10) but `stat_*` has been customized is automatically migrated: `attr_* = stat_*`. This is idempotent — safe to run every boot.

### 2. Duplicate population columns (pop_common vs pop_commoners)
**Problem:** The old schema had `pop_common`; migrations added `pop_commoners`. Growth was writing to one, commands were reading the other.

**Fix (helpers.js → `initDB`):** On boot, copies `pop_common → pop_commoners` for any row where they differ.

### 3. Orphaned buildings (town IDs 2, 4, 5 missing)
**Problem:** Buildings referenced town IDs that no longer exist. These were producing phantom resources or crashing JOIN queries.

**Fix (helpers.js → `initDB`):** On boot, `DELETE FROM buildings WHERE town_id NOT IN (SELECT id FROM towns)` cleans all orphans.

### 4. Military maintenance never charged
**Problem:** `mil_maintenance_cost` was set to 0 for all rows even when `pop_soldiers > 0`. Soldiers were free to maintain indefinitely.

**Fix (helpers.js → `initDB` + scheduler.js):**
- `initDB` now sets `mil_maintenance_cost = pop_soldiers` for any row where soldiers > 0 but cost is 0.
- `handleRecruit` (action.js) now increments `mil_maintenance_cost` by the number of soldiers recruited.
- The daily scheduler now deducts maintenance from `food_surplus`. If food runs out, soldiers desert proportionally and stability takes -1.

---

## Balance fixes

### 5. Stability multiplier — soft curve replaces zero-floor
**Old formula:** `stabMult = (rate_stab + 10) / 20`
- At default +10: gives 1.0 (no upside ever, new players already at ceiling)
- At -10: gives 0.0 (total production wipe — unrecoverable)

**New formula (helpers.js → `calcStabMultiplier`):**
```
stabMult = 0.30 + ((rate_stab + 10) * 0.05)
```
| rate_stab | Old mult | New mult |
|-----------|----------|----------|
| +10 (max) | 1.00     | **1.30** |
|  0 (neutral) | 0.50  | **0.75** |
| −5 (danger)  | 0.25  | **0.55** |
| −10 (floor)  | 0.00  | **0.30** |

Players now have a meaningful **+30% upside** for maintaining high stability, and a **30% floor** instead of total wipe.

### 6. Noble generation delayed until 200 commoners
**Old behavior:** 100-pop starting town immediately generates 2 nobles who demand Vitale on day one. New players have no Vitale income → instant -2 stab, -3 prestige.

**New behavior (helpers.js → `calcNobleState`):** Nobles don't appear until population reaches 200. Below that, `nobles = 0` and no Vitale demand fires.

### 7. Grace period for new players (3 tax ticks)
**New column:** `tax_count INTEGER DEFAULT 0` (added via migration in `initDB`).

**New behavior:** For the first 3 tax collections, noble penalties and Vitale deficit penalties are suppressed even if Vitale is short. A "Grace Period — N ticks remaining" message shows in the population report so players understand the window.

### 8. Character stats now feed the macro game
New exported function: `getCharBonuses(user)` in helpers.js.

| Stat | Macro effect |
|------|-------------|
| STR mod | Reduces military maintenance cost by 1% per point (capped 30%) |
| MEN mod | Added to scout offense roll (shown in roll breakdown) |
| INT mod | +2% wealth production per point above 0 |
| WIS mod | +2% food production per point above 0 |
| CHA mod | Reserved for future faction relation system |
| MOT mod | Reserved for future build-timer reduction |

These bonuses are applied automatically in `handleTax` and `handleScout`. No code changes needed elsewhere — just use `getCharBonuses(user)`.

### 9. Tiered scout reveal
**Old behavior:** Success = dump everything; failure = nothing.

**New behavior (action.js → `handleScout`):**
- Roll margin < 5 above DC → partial reveal (building count only, names hidden)
- Roll margin ≥ 5 above DC → full reveal (all building names and details)
- MEN mod added to roll and shown in the breakdown

---

## UX improvements

### 10. Pre-crisis warning banners
New helpers: `getWarningLevel(rateStab, ratePrest)` and `formatWarningBanner(...)`.

- 🟡 Yellow warning appears in tax and census embeds when `rate_stab ≤ -2` or `rate_prest ≤ -1`
- 🔴 Red danger banner when `rate_stab ≤ -5` or `rate_prest ≤ -3`
- Embed color changes to match severity

### 11. Servus risk shown in `/atlas balance`
The balance embed now shows the Servus stability drain and adds a "⚠️ Rebellion risk" note if the drain puts stability in danger territory.

---

## Deployment steps

1. **Copy the 4 patched files** into their respective directories:
   - `helpers.js` → `src/utils/helpers.js`
   - `economy.js` → `src/commands/atlas/economy.js`
   - `action.js`  → `src/commands/atlas/action.js`
   - `scheduler.js` → `src/scheduler.js`

2. **Run the bot once** — `initDB` will apply all 5 data fixes automatically on boot. Check the console for `[DB] FIX 1–5` messages.

3. **Verify in Discord:**
   - `/atlas profile` — stats should reflect actual choices, not 8/8/8/8/10/10
   - `/atlas tax` — multiplier breakdown should show `Stability(×1.30)` for max-stab players
   - `/atlas population` — new players should show "None yet (appear at 200 commoners)"
   - `/atlas action scout` — roll breakdown should include MEN bonus if applicable

4. **No slash command re-sync needed** — no command signatures changed.


---

## 📁 Source: archive.md

# 🗃️ ATLAS — Archived Roadmap Tickets & Session Logs

> This file contains tickets that are **fully implemented** and removed from the active roadmap,
> plus session history logs. Do not re-implement these. Reference only.

---

## ARCHIVED SESSION LOGS

### SESSION 2 — 2026-05-11 (v1.3.0) — Antigravity / Gemini 2.5 Pro

| Ticket | Status | Notes |
|--------|--------|-------|
| **Ticket 1.1** — Constants + Schema | ✅ DONE | Akha removed. Tora added (lore pending). `house` field on all ancestries. `GREAT_HOUSES`, `VITALE_FREE_HOUSES`, `PLAYER_RANKS` exported. Gagoon→Caossa, Cellesela→Sellesela everywhere. |
| **Ticket 1.2** — New Buildings | ✅ DONE | Mine, Deep Mine, Furnace, Smeltery, Exotic Workshop added to `constants.js` with `ore_consumption`, `metallurgy_prod`, `exotic_prod` fields. |
| **Ticket 2.1** — Economy Rewrite | ✅ DONE | Metallurgy + Exotics in tax production loop. Caossa ancestry bonus (+30% met, +20% ore). Rank-aware Vitale (Sovereigns pay, others see info only). Ore consumption from Furnace/Smeltery. `getPlayerRank`, `isVitaleFree`, `getNotificationChannel` added to `helpers.js`. New columns migrated via `initDB`. |
| **Bug Fixes (v1.3.0)** | ✅ DONE | Leaderboard deferUpdate. Username persisted on every command. Autocomplete shows CharacterName (discorduser). Turn notification → `#main-hall` (1502560573710270555). Roll GUI ephemeral + public result. Player-only lock on Roll Oracle (userId encoded in customId). LVL/XP/AC/HP removed from profile and audit. Profile now shows Rank + Great House color. Mercs_temp wipe in scheduler. |

**Files changed in this session:**
- `src/data/constants.js` — Full rewrite
- `src/utils/helpers.js` — New helpers + migrations
- `src/commands/atlas/economy.js` — Metallurgy/Exotics, rank-aware Vitale
- `src/commands/atlas/character.js` — Profile redesign
- `src/commands/atlas/action.js` — Roll GUI player lock
- `src/commands/atlas.js` — Roll ephemeral, leaderboard deferUpdate
- `src/events/interactionCreate.js` — Username persistence, autocomplete
- `src/scheduler.js` — Main hall notification, mercs_temp wipe
- `changelog.md` — v1.3.0 entry

---

### SESSION 1 — 2026-05-10 (v1.2.x) — Gemini Flash

Implemented: DB migration block in `helpers.js`, `calcNobleState`, `calcStabMultiplier`, `getCharBonuses`, stability soft curve, noble grace period (3 ticks), military maintenance deduction, servus drain, warning banners, new buildings constants (stab_bonus, food_cost, pop_cap_bonus fields), economy tax split into 2 embeds.

Broke / removed by mistake (fixed in Session 2): Username autocomplete, LVL/XP/AC removal, leaderboard button, turn notification channel.

---

## ARCHIVED TICKET 1.1 — Tora Ancestry, Rank System, New DB Columns

**Status: ✅ DONE 2026-05-11**

Full prompt and self-verify checklist preserved here for reference. Implementation is in:
- `src/data/constants.js` — ANCESTRIES, GREAT_HOUSES, VITALE_FREE_HOUSES, PLAYER_RANKS
- `src/utils/helpers.js` — getPlayerRank, isVitaleFree, getNotificationChannel, initDB migrations

Key migrations added:
```sql
ALTER TABLE users ADD COLUMN player_rank TEXT DEFAULT 'SCION'
ALTER TABLE users ADD COLUMN great_house TEXT DEFAULT NULL
ALTER TABLE users ADD COLUMN metallurgy INTEGER DEFAULT 0
ALTER TABLE users ADD COLUMN mercs_temp INTEGER DEFAULT 0
ALTER TABLE users ADD COLUMN trade_route_slots INTEGER DEFAULT 3
ALTER TABLE users ADD COLUMN custom_title TEXT DEFAULT NULL
ALTER TABLE users ADD COLUMN notification_channel TEXT DEFAULT NULL
ALTER TABLE users ADD COLUMN tax_count INTEGER DEFAULT 0
```

---

## ARCHIVED TICKET 1.2 — New Buildings

**Status: ✅ DONE 2026-05-11**

Buildings added to `src/data/constants.js`:
- MINE (tier 1, ore_prod: 30)
- DEEP_MINE (tier 2, ore_prod: 70, food_cost: 10)
- FURNACE (tier 1, ore_consumption: 50, metallurgy_prod: 10)
- SMELTERY (tier 2, ore_consumption: 80, metallurgy_prod: 20)
- EXOTIC_WORKSHOP (tier 1, exotic_prod: 2, stab_bonus: 1)

---

## ARCHIVED TICKET 2.1 — handleTax, handlePopulation, handleBalance Rewrite

**Status: ✅ DONE 2026-05-11**

Full production loop implemented in `src/commands/atlas/economy.js`:
- Metallurgy and Exotics tracked and stored
- Caossa ancestry bonus (+30% met, +20% ore) applied before stab multiplier
- Rank-aware Vitale: only SOVEREIGN pays; SCION/DOMINAR see informational text only
- Ore consumption can go negative in embed (stored as MAX(0,...) in DB)
- Single DB UPDATE per tax call
- handleBalance shows metallurgy row

---

## ARCHIVED KNOWN BUGS — All Fixed

| Bug | Fix Applied |
|-----|-------------|
| Leaderboard `lb` button missing `deferUpdate()` | ✅ Fixed in atlas.js |
| Gagoon in FACTIONS array | ✅ Renamed to Caossa |
| `stat_*` vs `attr_*` column drift | ✅ Patched in helpers.js initDB |
| Orphaned buildings | ✅ Patched in helpers.js initDB |
| Username not saved for autocomplete | ✅ Fixed in interactionCreate.js |
| Turn notification going to wrong channel | ✅ Now goes to #main-hall |
| Roll GUI not player-locked | ✅ Fixed in action.js |
| LVL/XP/AC/HP showing in profile | ✅ Removed from character.js |

---

*Archive last updated: 2026-05-11 (Session 3)*
