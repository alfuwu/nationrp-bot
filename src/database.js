const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

// database.js: Core schema (users, towns, buildings, relations, global_settings, gm_whitelist)
// helpers.js initDB(): Extended schema (gm_events, trade_routes, treaties, duels, bets, pending_trades)
//   + idempotent ALTER TABLE migrations for all columns added after initial deploy.
// Both must be called on startup: setupDatabase() then initDB(db).

async function setupDatabase() {
    const db = await open({
        filename: path.join(__dirname, '../database.sqlite'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            ruler_name TEXT,
            nation TEXT,
            ancestry TEXT,
            upbringing TEXT,
            profession TEXT,
            age INTEGER DEFAULT 0,
            balance INTEGER DEFAULT 1000,
            wealth INTEGER DEFAULT 0,
            exotics INTEGER DEFAULT 0,
            food_surplus INTEGER DEFAULT 0,
            ores INTEGER DEFAULT 0,
            vitale INTEGER DEFAULT 0,
            servus INTEGER DEFAULT 0,
            pop_commoners INTEGER DEFAULT 100,
            pop_soldiers INTEGER DEFAULT 0,
            pop_nobles INTEGER DEFAULT 0,
            pop_servus INTEGER DEFAULT 0,
            pop_growth_rate REAL DEFAULT 0.01,
            attr_str INTEGER DEFAULT 10,
            attr_mot INTEGER DEFAULT 10,
            attr_men INTEGER DEFAULT 10,
            attr_int INTEGER DEFAULT 10,
            attr_wis INTEGER DEFAULT 10,
            attr_cha INTEGER DEFAULT 10,
            hp_max INTEGER DEFAULT 8,
            hp_current INTEGER DEFAULT 8,
            ac INTEGER DEFAULT 10,
            level INTEGER DEFAULT 1,
            xp INTEGER DEFAULT 0,
            description TEXT,
            rate_econ INTEGER DEFAULT 1,
            rate_def INTEGER DEFAULT 0,
            rate_stab INTEGER DEFAULT 10,
            rate_prest INTEGER DEFAULT 0,
            mil_strength INTEGER DEFAULT 0,
            mil_maintenance_cost INTEGER DEFAULT 0,
            last_tax INTEGER DEFAULT 0,
            last_daily INTEGER DEFAULT 0,
            tax_notified INTEGER DEFAULT 0,
            last_tax_channel TEXT,
            avatar_url TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS towns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            name TEXT,
            terrain_type TEXT,
            plots_total INTEGER,
            fertility INTEGER DEFAULT 50,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS buildings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            town_id INTEGER,
            type TEXT,
            level INTEGER DEFAULT 1,
            ready_at INTEGER,
            FOREIGN KEY(town_id) REFERENCES towns(id)
        );

        CREATE TABLE IF NOT EXISTS relations (
            user_id TEXT,
            faction_name TEXT,
            score INTEGER DEFAULT 0,
            PRIMARY KEY(user_id, faction_name),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS global_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS gm_whitelist (
            user_id TEXT PRIMARY KEY
        );

        INSERT OR IGNORE INTO global_settings (key, value) VALUES ('current_turn', '1');
        INSERT OR IGNORE INTO global_settings (key, value) VALUES ('empire_ruler', 'Tyrannite');
        INSERT OR IGNORE INTO global_settings (key, value) VALUES ('vitale_base', '15');
        INSERT OR IGNORE INTO global_settings (key, value) VALUES ('vitale_sold_week', '0');
    `);

    return db;
}

module.exports = { setupDatabase };
