const cron = require('node-cron');
const { calcMaintenance } = require('./utils/helpers');
const { processTradeRoutes } = require('./commands/atlas/trade');

function initScheduler(client) {
    const db = client.db;

    // ── Weekly Turn: Every Monday at 00:00 ──────────────────────────────────
    cron.schedule('0 0 * * 1', async () => {
        try {
            console.log('[SCHEDULER] Weekly Turn Protocol...');
            const row    = await db.get('SELECT value FROM global_settings WHERE key = "current_turn"');
            const newTurn = (parseInt(row?.value) || 0) + 1;

            await db.run('UPDATE global_settings SET value = ? WHERE key = "current_turn"', newTurn.toString());
            await db.run('UPDATE global_settings SET value = "0" WHERE key LIKE "demand_%"');

            // Process weekly trade routes
            await processTradeRoutes(db, client);

            // Wipe temp mercenaries each turn
            const mercWipe = await db.run('UPDATE users SET mercs_temp = 0 WHERE mercs_temp > 0');
            if (mercWipe.changes > 0) console.log(`[SCHEDULER] Mercenaries disbanded (${mercWipe.changes} players).`);

            console.log(`[SCHEDULER] Turn ${newTurn}. Vitale & general trade market reset.`);

            // Turn notification → #main-hall, not atlas-hq
            const mainHallId = process.env.MAIN_HALL_ID || '1502560573710270555';
            try {
                const chan = await client.channels.fetch(mainHallId);
                if (chan) await chan.send({ embeds: [{
                    title: '🏺 AGE TRANSITION',
                    description: `The Imperial clock has struck. We have entered **Turn ${newTurn}**.`,
                    color: 0xFFD700,
                    timestamp: new Date()
                }]});
            } catch (e) {
                console.error('[SCHEDULER] Could not send to main hall:', e.message);
            }
        } catch (error) {
            console.error('[SCHEDULER] Weekly Turn Failed:', error);
        }
    });

    // ── Daily Tax Notification (Runs at 12:00 AM GMT) ────────────────────────
    cron.schedule('0 0 * * *', async () => {
        try {
            // Fetch all users who have a valid channel recorded
            const users = await db.all(
                'SELECT id, last_tax_channel FROM users WHERE last_tax_channel IS NOT NULL'
            );
            
            for (const u of users) {
                try {
                    const channel = await client.channels.fetch(u.last_tax_channel);
                    if (channel) {
                        await channel.send({ content: `<@${u.id}> 🏛️ Your Imperial Tax is ready to be collected! Use \`/atlas tax\`.` });
                    }
                } catch {}
            }

            // Global reset: Mark everyone as ready to be notified again on their next cycle
            await db.run('UPDATE users SET tax_notified = 0');

        } catch (error) {
            console.error('[SCHEDULER] Daily Tax Notification Failed:', error);
        }
    }, {
        timezone: "Etc/UTC" // Ensures the cron runs precisely at 12 AM GMT/UTC regardless of host server time
    });

    // ── Daily Population Growth + Military Maintenance: 00:00 ───────────────
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('[SCHEDULER] Daily Population + Military Maintenance...');
            const users = await db.all('SELECT * FROM users WHERE status = "active"');

            for (const u of users) {
                const currentPop = u.pop_commoners || 0;
                const food       = u.food  || 0;

                // Calculate pop cap from buildings
                const towns = await db.all('SELECT id FROM towns WHERE user_id = ?', u.id);
                let popCap = 500; // base cap
                for (const t of towns) {
                    const bldgs = await db.all(
                        'SELECT type FROM buildings WHERE town_id = ? AND (ready_at IS NULL OR ready_at <= ?)',
                        t.id, Date.now()
                    );
                    const { BUILDINGS } = require('./data/constants');
                    for (const b of bldgs) {
                        const bd = BUILDINGS[b.type.toUpperCase()];
                        if (bd) popCap += (bd.pop_cap_bonus || 0);
                    }
                }

                let delta = 0;
                if (food > 0) {
                    delta = (Math.random() * 0.2 + 0.9) // ±10% variation
                        * Math.pow(currentPop, 0.13 * Math.log10(currentPop)) // increase growth based off population
                        * Math.min(1, food / currentPop) // decrease growth if there's not enough food surplus to feed everyone
                        * Math.min(1, (popCap - currentPop) / (Math.log10(currentPop) / Math.log10(1.1))) // decrease growth as population approaches cap, invert growth if over
                        / 250; // divide by 250 to make number reasonable
                    if (currentPop < popCap)
                        delta *= Math.sqrt(food) * Math.log10(food) // increase growth based off food surplus
                    else
                        delta *= 10 * Math.sqrt(food) * Math.log10(food) / food; // increase growth based off how little food is available (gets inverted by population being over popcap)
                } else if (food <= 0) {
                    delta = -Math.max(1, Math.floor(currentPop * 0.01)); // Famine: −1%/day
                }

                if (isNaN(delta))
                    delta = 0;
                if (delta < 0 && delta > -1)
                    delta = -1;
                else if (delta >= 0 && delta < 1 && currentPop < popCap && food > 0)
                    delta = 1;

                const maintenanceCost = calcMaintenance(u);
                let foodAfterMil = food + delta; // apply pop growth first

                let soldierDesertion = {};
                if (maintenanceCost > 0) {
                    if (foodAfterMil >= maintenanceCost) {
                        // Can pay full upkeep
                        foodAfterMil -= maintenanceCost;
                    } else {
                        // Shortage — desert proportionally from each unit type
                        const deficit = maintenanceCost - Math.max(0, foodAfterMil);
                        const desertRatio = Math.min(1, deficit / Math.max(1, maintenanceCost));
                        foodAfterMil = 0;
                        soldierDesertion = {
                            mil_militia:   Math.ceil((u.mil_militia   || 0) * desertRatio),
                            mil_spearmen:  Math.ceil((u.mil_spearmen  || 0) * desertRatio),
                            mil_swordsman: Math.ceil((u.mil_swordsman || 0) * desertRatio),
                            mil_shield:    Math.ceil((u.mil_shield    || 0) * desertRatio),
                            mil_cavalry:   Math.ceil((u.mil_cavalry   || 0) * desertRatio),
                            mil_ranged:    Math.ceil((u.mil_ranged    || 0) * desertRatio),
                            mil_siege:     Math.ceil((u.mil_siege     || 0) * desertRatio),
                            mercs_temp:    Math.ceil((u.mercs_temp    || 0) * desertRatio),
                        };
                        const totalDeserted = Object.values(soldierDesertion).reduce((a,b) => a+b, 0);
                        if (totalDeserted > 0) {
                            // Stability penalty
                            await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-1) WHERE id=?', u.id);
                            console.log(`[SCHEDULER] ${u.id}: ${totalDeserted} units deserted (${(desertRatio*100).toFixed(0)}% shortage).`);
                        }
                    }
                }

                // ── Food rot: 5%/day — surplus decays to prevent infinite hoarding ──
                // Applied after military maintenance. Min 0.
                foodAfterMil = Math.max(0, Math.floor(foodAfterMil * 0.95));

                // Calculate new maintenance cost after potential desertions
                const postDesertion = {
                    mil_militia:   (u.mil_militia   || 0) - (soldierDesertion.mil_militia   || 0),
                    mil_spearmen:  (u.mil_spearmen  || 0) - (soldierDesertion.mil_spearmen  || 0),
                    mil_swordsman: (u.mil_swordsman || 0) - (soldierDesertion.mil_swordsman || 0),
                    mil_shield:    (u.mil_shield    || 0) - (soldierDesertion.mil_shield    || 0),
                    mil_cavalry:   (u.mil_cavalry   || 0) - (soldierDesertion.mil_cavalry   || 0),
                    mil_ranged:    (u.mil_ranged    || 0) - (soldierDesertion.mil_ranged    || 0),
                    mil_siege:     (u.mil_siege     || 0) - (soldierDesertion.mil_siege     || 0),
                    mercs_temp:    (u.mercs_temp    || 0) - (soldierDesertion.mercs_temp    || 0),
                };
                const newMaintCost = calcMaintenance(postDesertion);

                // tax_notified lifecycle: economy.js resets → 0 on each tax collect;
                // hourly notifier sets → 1 after sending. Do NOT reset here — that
                // caused the midnight cron to re-arm notifications for players whose
                // 24h cooldown hadn't elapsed yet, firing a premature "tax ready" ping.
                await db.run(`
                    UPDATE users SET
                        pop_commoners         = MAX(0, pop_commoners + ?),
                        food                  = MAX(0, ?),
                        mil_militia           = MAX(0, mil_militia   - ?),
                        mil_spearmen          = MAX(0, mil_spearmen  - ?),
                        mil_swordsman         = MAX(0, mil_swordsman - ?),
                        mil_shield            = MAX(0, mil_shield    - ?),
                        mil_cavalry           = MAX(0, mil_cavalry   - ?),
                        mil_ranged            = MAX(0, mil_ranged    - ?),
                        mil_siege             = MAX(0, mil_siege     - ?),
                        mercs_temp            = MAX(0, mercs_temp    - ?),
                        mil_maintenance_cost  = ?
                    WHERE id = ?`,
                    delta,
                    foodAfterMil,
                    soldierDesertion.mil_militia   || 0,
                    soldierDesertion.mil_spearmen  || 0,
                    soldierDesertion.mil_swordsman || 0,
                    soldierDesertion.mil_shield    || 0,
                    soldierDesertion.mil_cavalry   || 0,
                    soldierDesertion.mil_ranged    || 0,
                    soldierDesertion.mil_siege     || 0,
                    soldierDesertion.mercs_temp    || 0,
                    newMaintCost,
                    u.id
                );

            }
            console.log('[SCHEDULER] Daily Population + Military Maintenance complete.');
        } catch (error) {
            console.error('[SCHEDULER] Daily Processing Failed:', error);
        }
    });

    console.log('[SCHEDULER] Cycles initialized: Weekly turn (Mon 00:00), Hourly tax notifier, Daily population/military (00:00).');
}

module.exports = { initScheduler };
