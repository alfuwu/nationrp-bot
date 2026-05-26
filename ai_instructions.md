# ATLAS — NationRP Discord Bot

A fantasy nation-roleplay Discord bot for the **Ares Heiliga League** setting. Players create characters via a Pathfinder-2e-inspired stat system, settle towns, build economies, raise armies, and compete for imperial dominance. Built on `discord.js` v14 with a SQLite-backed persistence layer and `node-cron` scheduled automation.

## What It Does

- **Character creation** — Roll for age, choose ancestry (13 lineages across 8 great houses), upbringing, profession, and distribute free stat boosts. Characters have 6 attributes (STR/MOT/MEN/INT/WIS/CHA), HP, AC, level, and XP.
- **Imperial Audit** — New characters require GM approval before becoming active in the game.
- **Town settlement** — Claim land with a terrain type (Plains, Mountain, Forest, Coastal, Hills, Riverlands, Swamp) and construct buildings across 4 categories: Economy (Farms, Mines, Markets), Defense (Walls), Stability (Churches, Academies), Military (Barracks, Castles, Palaces).
- **Daily tax cycles** — Collect income from buildings weighted by terrain multipliers, ancestry bonuses, and stability. A 24-hour cooldown with hourly reminder notifications.
- **Population system** — Commoners, soldiers, nobles, and servus grow or shrink based on food surplus and building capacity. Nobles demand Vitale (a luxury resource) or revolt.
- **Resource economy** — Wealth, Food, Ores, Vitale, Exotics, Metallurgy, and Servus. Donate personal balance to national wealth. Found a sovereign nation at 100,000 wealth.
- **Faction diplomacy** — 12 NPC factions (Tyrannite, Caossa, Rhagaia, Sellesela, Gaius, Sciatic League, etc.) with relation scores, bribery, and faction-specific unlock bonuses/penalties.
- **Trade routes** — Player-to-player and player-to-NPC resource exchanges with duration limits and relation gates.
- **Military command** — Recruit unit types (Militia, Spearmen, Swordsman, Shield Infantry, Cavalry, Ranged, Siege), scout enemy settlements, declare field battles, lay sieges, and conduct raids. Unit types have food maintenance costs; soldiers desert if food runs out.
- **Warfare engine** — Army power calculation with morale weighting, terrain combat modifiers, formation picking (Shield Wall, Wedge, Line, Schiltron, Flanking), and ancestry-synergy bonuses.
- **Colosseum arena** — Rock-paper-scissors style duels with Heavy Attack/Defend/Quick Strike stances, terrain modifiers, spectator betting with odds, and dramatic announcer narration posted to a dedicated channel.
- **Dice oracle** — Roll d20 stat checks or raw dice (d4–d100) via interactive select menus.
- **Leaderboards** — Imperial rankings across Total, Economy, Defense, Stability, and Offense categories.
- **GM tools** — Whitelist-based admin commands for editing player/settlement/nation data, firing/undoing world events (famine, plague, raids, bumper harvests, noble unrest, imperial favor, uprisings, war tribute), purging players, and viewing a global dashboard.
- **Scheduled automation** — Weekly turn progression (Monday midnight), daily population growth and military maintenance, hourly tax reminders.

## How to Run

### Prerequisites

- Node.js 18+
- A Discord bot application with the following privileged gateway intents enabled: **Server Members**, **Message Content**.

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file** in the repository root:

   | Variable | Required | Purpose |
   | :--- | :---: | :--- |
   | `DISCORD_TOKEN` | yes | Bot token from the Discord Developer Portal. |
   | `GUILD_ID` | recommended | Guild ID for instant slash-command registration. Without it, commands sync globally (can take up to an hour). |
   | `ADMIN_CHANNEL_ID` | optional | Channel for Imperial Audit notifications and weekly Age Transition embeds. Falls back to `1483005224376467599`. |
   | `OWNER_ID` | optional | Discord user ID that bypasses all permission gates. Defaults to `317883862258548737`. |
   | `MAIN_HALL_ID` | optional | Channel for turn-change announcements. Defaults to `1502560573710270555`. |

3. **Set the bot avatar (optional):** Place `avatar.gif` or `avatar.png` in the `assets/` directory. The bot will automatically set its avatar on startup, falling back to a remote URL if no local file is found.

4. **Launch the bot:**
   ```bash
   npm start
   ```
   The first boot creates `database.sqlite` in the repository root, runs all migrations (`src/database.js` + `src/utils/helpers.js` `initDB`), and registers slash commands to the configured guild.

### Testing

There is currently **no automated test suite**. The `npm test` script is a placeholder. Testing is done manually by running the bot in a Discord server and executing slash commands. To verify changes:

1. Start the bot locally with `npm start`.
2. Check the console for `[ATLAS] v1.2.0 Systems Online.` and `[SCHEDULER] Cycles initialized`.
3. Use `/atlas begin` to create a test character, approve it via `/admin user edit`, then exercise the other commands.

## Architecture

### Directory Layout

```
src/
  index.js                  Entry point — creates Discord.js client, loads commands/events,
                            applies undici IPv4 agent, global error handlers.

  database.js               SQLite schema: users, towns, buildings, relations,
                            global_settings, gm_whitelist tables.

  scheduler.js              node-cron jobs: weekly turn (Mon 00:00), hourly tax notifier,
                            daily population growth and military maintenance.

  data/
    constants.js            All static game data: terrains, buildings (with production stats),
                            ancestries, great houses, player ranks, upbringing/profession bonuses,
                            stat mappings, army types, formations, duel stances, factions, resources.

  utils/
    helpers.js              Shared utilities: stat math (getMod, applyBoost), auth (isOwner, isGM),
                            stability multiplier (soft curve 0.30–1.30), character bonuses bridge,
                            population/noble helpers, morale & maintenance calculators,
                            DB migration runner (initDB).

  events/
    ready.js                On boot: runs DB setup, initializes scheduler, syncs avatar,
                            registers slash commands to guild (clears global to avoid duplicates).
    interactionCreate.js    Central dispatcher: autocomplete (user, resource, town, stat lookups),
                            slash commands → command.execute(), buttons/modals/select menus →
                            atlas.js handler methods.

  commands/
    atlas.js                Main player slash command (/atlas). Defines subcommands/subcommand groups,
                            routes execute() to subsystem handlers, delegates button/modal/select
                            interactions to the correct module.
    admin.js                GM slash command (/admin). Subcommand groups: user (edit/purge/setchannel),
                            town (edit/remove/list), nation (view/edit/remove), relation (set),
                            event (fire/undo/list), system (edit/whitelist). Dashboard view.

    atlas/
      character.js          /atlas begin — age roll, ancestry/upbringing/profession picker (interactive
                            buttons), free boost distributor, biography modal, audit submission to HQ.
      economy.js            /atlas tax — daily building production loop with terrain multipliers,
                            ancestry bonuses, stability scaling, noble Vitale demands, rebellion checks.
                            /atlas balance, /atlas population, /atlas donate, /atlas empire (Vitale market).
      town.js               /atlas town — settle new towns (terrain picker → name modal), building
                            construction/upgrade/demolish with cost deduction and build timers.
      military.js           /atlas military — select menu to scout/recruit/battle/siege/raid.
                            Recruitment: buy units with population conversion and barracks requirement.
      warfare.js            Battle/siege/raid resolution engine. Army power calc (unit counts × morale),
                            terrain combat modifiers, formation selection (Shield Wall/Wedge/Line/etc.),
                            defender notification flow, ancestry/race synergy bonuses.
      diplomacy.js          /atlas diplomacy — faction relation bars (🟩🟨🟥), bribery (cooldown-gated),
                            treaties (non-aggression/defensive/alliance), pending battle response.
      trade.js              Trade route proposal/acceptance for player and NPC (Sciatic, Caossa, Styx)
                            partners. Weekly route processing in scheduler.
      colosseum.js          /atlas colosseum — arena duel creation (pick opponent, set wager),
                            stance picking (Heavy/Defend/Quick), spectator betting with dynamic odds,
                            round-by-round narration posted to the colosseum channel.
      action.js             /atlas roll — dice oracle (stat check or raw die via select menus).
                            /atlas gm roll — GM-triggered skill checks with DC for any player.
                            /atlas nation found — nation founding (100,000 wealth cost).
      events.js             GM world event system: fire events (famine/plague/raid/harvest/etc.) with
                            severity levels, undo within 1 hour, event history listing.
      leaderboard.js        /atlas leaderboard — computes scores (economy/defense/stability/offense/total)
                            from buildings, military, resources, and rates. Top-10 display with medal emojis.
      battlename.js         Generates thematic battle names from prefix/noun combinatorial pools.
```

### Data Flow

1. **Startup:** `index.js` creates the client → loads commands & events → logs in. `ready.js` initializes the database (schema + migrations), starts the scheduler, sets the avatar, and registers slash commands to the guild.
2. **Character flow:** `/atlas begin` → `character.js` age roll → ancestry pick → upbringing pick → profession pick → free boost distributor → biography modal → post to `ADMIN_CHANNEL_ID` for GM audit. GM approves/denies via buttons → status set to `active`.
3. **Gameplay flow:** Active players use `/atlas` subcommands. Each interaction goes through `interactionCreate.js` → deferred reply → user lookup → auth check → subsystem handler. Buttons/modals/selects are routed through `atlas.js` handler methods back to the subsystem that originated them.
4. **Scheduled automation:** `scheduler.js` uses `node-cron` to run population growth (checking food/cap), military maintenance (desertion on food deficit), weekly turn advancement (increment turn, process trade routes, wipe temp mercs), and hourly tax reminders.

### Database

SQLite (`database.sqlite`) with 6 tables managed through `sqlite` / `sqlite3`:

| Table | Purpose |
| :--- | :--- |
| `users` | Player profiles: stats, resources, population counts, military units, rates, pending battle lock, character creation fields. |
| `towns` | Settlements: name, terrain, plot count, fertility. Linked to `users.id`. |
| `buildings` | Structures per town: type, level, `ready_at` timestamp for construction timers. Linked to `towns.id`. |
| `relations` | Faction standing per player: faction name → score. |
| `global_settings` | Key-value store for turn counter, empire ruler name, Vitale base price. |
| `gm_whitelist` | User IDs with GM privileges. |

Additional tables created by `initDB()` in `helpers.js`: `gm_events`, `trade_routes`, `treaties`, `duels`, `bets`.

Migrations are idempotent `ALTER TABLE ADD COLUMN` statements wrapped in try/catch, plus data fix queries (stat_ → attr_ migration, pop_common → pop_commoners, nation_name → nation, mil_infantry → mil_swordsman, orphaned building cleanup).

### Key Dependencies

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `discord.js` | ^14.25.1 | Discord API client, slash commands, embeds, interactions. |
| `node-cron` | ^4.2.1 | Cron-based scheduled tasks (weekly/daily/hourly). |
| `sqlite` / `sqlite3` | ^5.1.1 / ^6.0.1 | SQLite database backend. |
| `dotenv` | ^17.3.1 | `.env` file loading for configuration. |
| `undici` | (transitive) | Discord.js HTTP client — forced to IPv4 in `index.js` to prevent connection timeouts. |

## License

ISC
