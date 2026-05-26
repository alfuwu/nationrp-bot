const { EmbedBuilder } = require('discord.js');
const { isGM, getNotificationChannel, resolveAtlasHQ } = require('../../utils/helpers');

// Lazy-load warfare to avoid circular-require issues at module init time
let _warfare;
function getWarfare() {
    if (!_warfare) _warfare = require('./warfare');
    return _warfare;
}

const EVENT_TYPES = {
    famine:         { title: '🌾 FAMINE',         desc: 'Crops fail and food stores dwindle. Severity: {sev}/3.',          color: 0xCC4400 },
    plague:         { title: '☠️ PLAGUE',         desc: 'Sickness spreads through the population. Severity: {sev}/3.',       color: 0x884400 },
    raid:           { title: '⚔️ RAID',           desc: 'Bandits have struck your territory and plundered your wealth. Severity: {sev}/3.', color: 0xFF4400 },
    harvest:        { title: '🌻 BUMPER HARVEST', desc: 'The fields yield abundantly this season. Food and stability improve.', color: 0x44BB00 },
    noble_unrest:   { title: '👑 NOBLE UNREST',   desc: 'The nobility grows restless and discontent. Prestige suffers.',     color: 0xDD8800 },
    imperial_favor: { title: '🏛️ IMPERIAL FAVOR', desc: 'The Empire looks upon you with grace. Vitale and prestige are granted.', color: 0xFFD700 },
    servus_uprising:{ title: '🔗 UPRISING',       desc: 'Your bound laborers have risen against their conditions. Military response required.', color: 0xFF0000 },
    tribute:        { title: '⚖️ WAR TRIBUTE',    desc: 'By Imperial decree, war tribute is extracted from your treasury.',  color: 0x444444 }
};

async function handleEventFire(interaction, type, targetId, severity, amount) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id))
        return interaction.editReply({ content: 'Access Denied.' });

    const user = await db.get('SELECT * FROM users WHERE id = ? AND status = "active"', targetId);
    if (!user) return interaction.editReply({ content: '⚠️ Target lineage not found or not active.' });

    const def = EVENT_TYPES[type];
    if (!def) return interaction.editReply({ content: `Unknown event type: ${type}` });

    // Build snapshot of fields before changes
    const snapshotFields = getAffectedFields(type, user);
    const snapshot = {};
    for (const f of snapshotFields) snapshot[f] = user[f];

    // Apply effects
    const effects = await applyEventEffects(db, user, type, severity, amount);

    // Insert event record
    const now = Date.now();
    await db.run(
        'INSERT INTO gm_events (user_id, gm_id, event_type, severity, effect_snapshot, resolved, created_at) VALUES (?,?,?,?,?,0,?)',
        targetId, interaction.user.id, type, severity, JSON.stringify(snapshot), now
    );

    // Build and send embed to player
    const chan = await getNotificationChannel(interaction.client, user);
    if (chan) {
        const emb = new EmbedBuilder()
            .setTitle(def.title)
            .setDescription(formatDesc(def.desc, severity))
            .setColor(def.color)
            .setFooter({ text: `Event ID: ${type} | Severity: ${severity}` });
        try { await chan.send({ content: `<@${targetId}>`, embeds: [emb] }); } catch (_) {}
    }

    // Notify GM HQ
    await resolveAtlasHQ(interaction.client,
        new EmbedBuilder()
            .setTitle('📋 EVENT FIRED')
            .setDescription(`**${def.title}** fired on <@${targetId}> (sev ${severity})${amount ? ` | amount ${amount}` : ''}\nUse \`/admin event undo target:${targetId} type:${type}\` within 1h to reverse.`)
            .setColor(def.color)
    );

    return interaction.editReply({ content: `✅ Event fired: **${def.title}** on <@${targetId}>. Use \`/admin event undo\` within 1h to reverse.` });
}

async function handleEventUndo(interaction, targetId, eventType) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id))
        return interaction.editReply({ content: 'Access Denied.' });

    const oneHourAgo = Date.now() - 3600000;
    const evt = await db.get(
        'SELECT * FROM gm_events WHERE user_id=? AND event_type=? AND resolved=0 AND created_at>=? ORDER BY id DESC LIMIT 1',
        targetId, eventType, oneHourAgo
    );
    if (!evt) return interaction.editReply({ content: `No recent undoable **${eventType}** event for this player (1h window expired).` });

    // Restore snapshot
    const snapshot = JSON.parse(evt.effect_snapshot || '{}');
    const def = EVENT_TYPES[eventType];
    if (eventType === 'servus_uprising') {
        await restoreFields(db, targetId, snapshot);
    } else {
        await restoreFields(db, targetId, snapshot);
    }

    await db.run('UPDATE gm_events SET resolved=1 WHERE id=?', evt.id);
    return interaction.editReply({ content: `↩️ **${def?.title || eventType}** event reversed for <@${targetId}>.` });
}

async function handleEventList(interaction, targetId) {
    const db = interaction.client.db;
    if (!await isGM(db, interaction.user.id))
        return interaction.editReply({ content: 'Access Denied.' });

    const events = await db.all(
        'SELECT * FROM gm_events WHERE user_id=? ORDER BY id DESC LIMIT 10', targetId
    );
    if (!events.length) return interaction.editReply({ content: 'No event history for this player.' });

    const lines = events.map(e => {
        const def = EVENT_TYPES[e.event_type];
        const date = new Date(e.created_at).toLocaleString();
        const status = e.resolved ? '↩️ Reversed' : '⚡ Active';
        return `**${def?.title || e.event_type}** (sev ${e.severity}) — ${date} — ${status}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`📋 EVENT HISTORY — ${targetId}`)
        .setDescription(lines.join('\n'))
        .setColor(0x0099FF);

    return interaction.editReply({ embeds: [embed] });
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function getAffectedFields(type, user) {
    switch (type) {
        case 'famine':         return ['food_surplus', 'rate_stab'];
        case 'plague':         return ['pop_commoners', 'rate_stab'];
        case 'raid':           return ['wealth'];
        case 'harvest':        return ['food_surplus', 'rate_stab'];
        case 'noble_unrest':   return ['rate_prest'];
        case 'imperial_favor': return ['rate_prest', 'vitale'];
        case 'servus_uprising':return ['rate_stab', 'servus', 'wealth'];
        case 'tribute':        return ['wealth'];
        default: return [];
    }
}

async function applyEventEffects(db, user, type, severity, amount) {
    const sev = severity || 1;
    switch (type) {
        case 'famine':
            await db.run('UPDATE users SET food_surplus=MAX(-9999,food_surplus-?), rate_stab=MAX(-10,rate_stab-?) WHERE id=?',
                500 * sev, sev, user.id);
            break;
        case 'plague':
            const newPop = Math.max(10, Math.floor((user.pop_commoners || 100) * (1 - 0.15 * sev)));
            await db.run('UPDATE users SET pop_commoners=?, rate_stab=MAX(-10,rate_stab-?) WHERE id=?',
                newPop, sev, user.id);
            break;
        case 'raid':
            await db.run('UPDATE users SET wealth=MAX(0,wealth-?) WHERE id=?',
                500 * sev, user.id);
            break;
        case 'harvest':
            await db.run('UPDATE users SET food_surplus=food_surplus+?, rate_stab=MIN(10,rate_stab+1) WHERE id=?',
                2000 * sev, user.id);
            break;
        case 'noble_unrest':
            await db.run('UPDATE users SET rate_prest=MAX(-10,rate_prest-?) WHERE id=?',
                2 * sev, user.id);
            break;
        case 'imperial_favor':
            await db.run('UPDATE users SET rate_prest=MIN(10,rate_prest+3), vitale=COALESCE(vitale,0)+? WHERE id=?',
                10 * sev, user.id);
            break;
        case 'servus_uprising':
            await handleServusUprising(db, user, sev);
            break;
        case 'tribute':
            await db.run('UPDATE users SET wealth=MAX(0,wealth-?) WHERE id=?',
                amount || 0, user.id);
            break;
    }
}

async function handleServusUprising(db, user, sev) {
    try {
        const warfare = getWarfare();
        if (warfare.handleRebellionEvent) {
            return await warfare.handleRebellionEvent(db, user);
        }
    } catch (_) {}
    await db.run('UPDATE users SET rate_stab=MAX(-10,rate_stab-?), servus=MAX(0,servus-10), wealth=MAX(0,wealth-1000) WHERE id=?',
        3 * sev, user.id);
}

async function restoreFields(db, targetId, snapshot) {
    const sets = [];
    const vals = [];
    for (const [key, val] of Object.entries(snapshot)) {
        sets.push(`${key}=?`);
        vals.push(val);
    }
    if (sets.length > 0) {
        await db.run(`UPDATE users SET ${sets.join(',')} WHERE id=?`, ...vals, targetId);
    }
}

function formatDesc(template, severity) {
    return template.replace(/\{sev\}/g, String(severity || 1));
}

module.exports = { handleEventFire, handleEventUndo, handleEventList };
