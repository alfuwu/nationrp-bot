const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { STAT_MAPPING, EMOJIS, STAT_KEYS } = require('../../data/constants');
const { getMod, fmtMod, isGM, isOwner, ephemeralReply } = require('../../utils/helpers');
const warfare = require('./warfare');

// ─── Nation founding ──────────────────────────────────────────────────────────

async function handleNationFound(interaction) {
    const db   = interaction.client.db;
    const name = interaction.options.getString('name').trim();
    const user = await db.get('SELECT wealth, nation FROM users WHERE id = ?', interaction.user.id);

    if (user.nation) return interaction.editReply({ content: '⚠️ You are already the sovereign of a nation.' });
    if ((user.wealth || 0) < 100000) return interaction.editReply({ content: '⚠️ Founding a nation requires **100,000 ⚖️**. Use `/atlas donate` to convert Balance → Wealth.' });

    const check = await db.get('SELECT id FROM users WHERE LOWER(nation) = ?', name.toLowerCase());
    if (check) return interaction.editReply({ content: '⚠️ A nation with that name already exists.' });

    await db.run('UPDATE users SET wealth = wealth - 100000, nation = ? WHERE id = ?', name, interaction.user.id);

    const embed = new EmbedBuilder().setTitle('👑 NATION FOUNDED').setColor(0xFFD700)
        .setDescription(`The sovereign nation of **${name}** has been established.\nYou may now access Imperial protocols and the Vitale market.`);
    return interaction.editReply({ embeds: [embed] });
}

// ─── Dice Oracle ──────────────────────────────────────────────────────────────

async function renderRollGUI(interaction, userId) {
    const uid = userId || interaction.user.id;
    const embed = new EmbedBuilder().setTitle('🎲 DICE ORACLE').setColor(0xFFD700)
        .setDescription('**Select an attribute** for a check (1d20 + modifier) or choose a **raw die**.');

    const statMenu = new StringSelectMenuBuilder()
        .setCustomId(`roll_stat_${uid}`)
        .setPlaceholder('Choose an Attribute Check...')
        .addOptions(Object.entries(STAT_MAPPING).map(([k, v]) => ({ label: v.name, value: k, emoji: EMOJIS[k] || '🎲' })));

    const dieMenu = new StringSelectMenuBuilder()
        .setCustomId(`roll_raw_${uid}`)
        .setPlaceholder('Choose a Raw Die (d4 – d100)...')
        .addOptions(['4', '6', '8', '10', '12', '20', '100'].map(d => ({ label: `d${d}`, value: d, emoji: '🎲' })));

    return interaction.editReply({ embeds: [embed], components: [
        new ActionRowBuilder().addComponents(statMenu),
        new ActionRowBuilder().addComponents(dieMenu),
    ]});
}

async function handleUserRoll(interaction) {
    return await renderRollGUI(interaction, interaction.user.id);
}

async function handleSelect(interaction, action, args) {
    const db  = interaction.client.db;
    const sub = args[0];

    if (action === 'roll') {
        if (sub === 'stat') {
            // customId: roll_stat_{uid} → args=['stat', uid]
            const uid = args[1] || interaction.user.id;
            if (uid !== interaction.user.id) {
                return ephemeralReply(interaction, '⚠️ Only the player who opened this Oracle may use it.');
            }
            const statKey  = interaction.values[0];
            const statData = STAT_MAPPING[statKey];
            await interaction.deferUpdate();

            const embed = new EmbedBuilder().setTitle(`🎲 ${statData.name.toUpperCase()}`).setColor(0xFFD700)
                .setDescription(`Select a sub-skill under **${statData.name}**, or roll a general check.`);

            const subMenu = new StringSelectMenuBuilder()
                .setCustomId(`roll_substat_${statKey}_${uid}`)
                .setPlaceholder(`Select ${statData.name} skill...`)
                .addOptions([
                    { label: `General ${statData.name} Check`, value: 'none', emoji: '🎲' },
                    ...statData.sub.map(s => ({ label: s, value: s, emoji: '✨' }))
                ]);

            return interaction.editReply({ embeds: [embed], components: [
                new ActionRowBuilder().addComponents(subMenu),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`roll_back_${uid}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
                )
            ]});
        }

        if (sub === 'substat') {
            // customId: roll_substat_{statKey}_{uid} → args=['substat', statKey, uid]
            const statKey  = args[1];
            const uid      = args[2];
            if (uid && interaction.user.id !== uid) {
                return ephemeralReply(interaction, '⚠️ Only the player who opened this Oracle may use it.');
            }
            const subSkill = interaction.values[0];
            const user     = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);
            const dbKey    = STAT_KEYS[statKey] || `attr_${statKey}`;
            const val      = user[dbKey] || 10;
            const mod      = getMod(val);
            const roll     = Math.floor(Math.random() * 20) + 1;
            const total    = roll + mod;

            await interaction.deferUpdate();
            const label = subSkill === 'none'
                ? STAT_MAPPING[statKey].name
                : `${STAT_MAPPING[statKey].name} · ${subSkill}`;

            await interaction.followUp({
                ephemeral: false,
                content: `🎲 **${interaction.user.displayName}** rolled **${label}** — 1d20 (**${roll}**) ${fmtMod(mod)} = **${total}**`
            });

            return interaction.editReply({ embeds: [
                new EmbedBuilder().setTitle('🎲 DICE ORACLE').setColor(0x00FF88)
                    .setDescription(`Result posted! Click Roll Again to continue.`)
            ], components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`roll_back_${uid || interaction.user.id}`).setLabel('Roll Again').setStyle(ButtonStyle.Primary)
                )
            ]});
        }

        if (sub === 'raw') {
            // customId: roll_raw_{uid} → args=['raw', uid]
            const uid = args[1];
            if (uid && interaction.user.id !== uid) {
                return ephemeralReply(interaction, '⚠️ Only the player who opened this Oracle may use it.');
            }
            const sides = parseInt(interaction.values[0]);
            const roll  = Math.floor(Math.random() * sides) + 1;
            await interaction.deferUpdate();

            await interaction.followUp({
                ephemeral: false,
                content: `🎲 **${interaction.user.displayName}** rolled **d${sides}** — **${roll}**`
            });

            return interaction.editReply({ embeds: [
                new EmbedBuilder().setTitle('🎲 DICE ORACLE').setColor(0x00FF88)
                    .setDescription(`d${sides} result posted! Click Roll Again to continue.`)
            ], components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`roll_back_${uid || interaction.user.id}`).setLabel('Roll Again').setStyle(ButtonStyle.Primary)
                )
            ]});
        }
    }
}

async function handleGMRoll(interaction) {
    const db = interaction.client.db;
    if (!(await isGM(db, interaction.user.id)) && !isOwner(interaction.user.id)) {
        return interaction.editReply({ content: '⚠️ Oracle protocols restricted to Game Masters.' });
    }

    const targetId = interaction.options.getString('user');
    const stat     = interaction.options.getString('stat');
    const substat  = interaction.options.getString('substat');
    const dc       = interaction.options.getInteger('dc');
    const type     = interaction.options.getString('type') || '20';

    const target = await db.get('SELECT * FROM users WHERE id = ?', targetId);
    if (!target) return interaction.editReply({ content: '⚠️ Target lineage not found.' });

    const sides = parseInt(type);
    const dbKey = STAT_KEYS[stat] || `attr_${stat}`;
    const val   = target[dbKey] || 10;
    const mod   = getMod(val);
    const roll  = Math.floor(Math.random() * sides) + 1;
    const total = roll + mod;

    const success = total >= dc;
    const label   = substat ? `${stat.toUpperCase()} (${substat})` : stat.toUpperCase();
    const embed   = new EmbedBuilder()
        .setTitle(`👁️ ORACLE CHECK: ${label}`)
        .setColor(success ? 0x00FF88 : 0xFF0000)
        .setDescription([
            `Target: <@${targetId}>`,
            `DC: **${dc}**`,
            ``,
            `Roll: 1d${sides} (${roll}) ${fmtMod(mod)} = **${total}**`,
            ``,
            `**Result: ${success ? 'SUCCESS ✅' : 'FAILURE ❌'}**`,
        ].join('\n'));

    return interaction.editReply({ content: `<@${targetId}>`, embeds: [embed] });
}

async function handleButton(interaction, action, args) {
    const db = interaction.client.db;

    if (action === 'roll' && args[0] === 'back') {
        const uid = args[1] || interaction.user.id;
        if (uid !== interaction.user.id) {
            return ephemeralReply(interaction, '⚠️ Only the player who opened this Oracle may use it.');
        }
        await interaction.deferUpdate();
        return await renderRollGUI(interaction, uid);
    }

    if (action === 'rebellion' && args[0] === 'suppress') {
        await interaction.deferUpdate();
        const user = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
        const result = await warfare.handleRebellionEvent(db, user);
        if (result?.type === 'servus') {
            const msg = result.result === 'suppressed'
                ? '⚔️ **SERVUS REBELLION SUPPRESSED** — Your forces crushed the uprising. −1 Stability, −5 Servus.'
                : '🔗 **SERVUS REBELLION OVERWHELMS YOU** — The laborers broke free. −5 Stability, −2000 Wealth, all Servus lost.';
            return interaction.editReply({ content: msg, embeds: [], components: [] });
        }
        return interaction.editReply({ content: 'No active rebellion detected.', embeds: [], components: [] });
    }

    if (action === 'revolt' && args[0] === 'suppress') {
        await interaction.deferUpdate();
        const user = await db.get('SELECT * FROM users WHERE id=?', interaction.user.id);
        const result = await warfare.handleRebellionEvent(db, user);
        if (result?.type === 'noble') {
            const msg = result.result === 'suppressed'
                ? '📜 **NOBLE REVOLT SUPPRESSED** — Your loyalists held the line. −1 Prestige.'
                : '⚠️ **NOBLE REVOLT SUCCEEDS** — You have been **DEPOSED**. The High Command must intervene.';
            return interaction.editReply({ content: msg, embeds: [], components: [] });
        }
        return interaction.editReply({ content: 'No active revolt detected.', embeds: [], components: [] });
    }
}

module.exports = {
    handleNationFound,
    handleUserRoll, handleGMRoll, handleButton, handleSelect
};
