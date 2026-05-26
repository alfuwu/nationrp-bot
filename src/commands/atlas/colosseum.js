const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { TERRAINS, DUEL_STANCES, DUEL_TERRAIN_MODS } = require('../../data/constants');
const { calcMorale, getMod, sendToPlayer, safeReply, ephemeralReply } = require('../../utils/helpers');

const hpBar = (hp) => '🟩'.repeat(Math.max(0, Math.min(10, hp))) + '🟥'.repeat(Math.max(0, 10 - Math.min(10, hp)));

const COLOSSEUM_CHANNEL = process.env.COLOSSEUM_CHANNEL_ID || '1505508124239466576';
const ENTRY_GIF = 'https://images-ext-1.discordapp.net/external/LWOX54CKJj8IqkvcQjwwlfjUx0BandNH060qMihzU_0/https/media4.giphy.com/media/v1.Y2lkPTczYjhmN2Ixb2JhenB5cGd1dW9zNGluMjdjam5yaG05cjJraWxobTg0OWs1bWUxZyZlcD12MV9naWZzX2dpZklkJmN0PWc/OOri31H3PKD4fM6tdl/giphy.mp4';
const VS_GIF = 'https://images-ext-1.discordapp.net/external/KTmzYP_v73BWarLGMlOvnUpmEAS6m1QeyC6NsUKWzis/https/media0.giphy.com/media/v1.Y2lkPTczYjhmN2IxbTl4a2Z3NXcxdmlqaWl0YzhuejBjdzN4dGkyZWZxdnpkZ3N2OXNtbyZlcD12MV9naWZzX2dpZklkJmN0PWc/7t3gLwtVBaP8okfZyg/giphy.mp4';
const CLAP_GIF = 'https://images-ext-1.discordapp.net/external/QI7G8lcthauy8c6rvlRtnV3CxgP2RMkxo6AjOyOYcpI/https/media1.giphy.com/media/v1.Y2lkPTczYjhmN2IxYjdobjZoZGsycnVjdGg3NXBpYmlvcGExMjgxZmFibHdsaDBtdWd4cSZlcD12MV9naWZzX2dpZklkJmN0PWc/trSsqWQSi96E7eeEAx/giphy.mp4';

const ANNOUNCER_INTROS = [
    '🎺 *The trumpets blare as the crowd roars!* The next contestant enters the arena...',
    '⚔️ *Sand swirls beneath the gate as it slowly rises...* A challenger approaches!',
    '🔥 *The braziers flare to life!* The Colosseum welcomes its next warrior!',
    '👑 *The Emperor raises his hand, then drops it!* Let the duel commence!',
    '🏛️ *The crowd stomps their feet in thunderous rhythm!* Two warriors, one arena!',
    '⚡ *Lightning cracks overhead as storm clouds gather!* Fate awaits in the arena today!',
    '🍷 *Spectators lean forward, spilling wine in anticipation!* The next bout is about to begin!',
    '🦁 *The arena gates groan open!* Dust and glory await!',
];

const ANNOUNCER_ROUNDS = [
    '🩸 *The crowd gasps!* What a blow!',
    '⚔️ *Steel clashes against steel!* The crowd is on its feet!',
    '🔥 *A brutal exchange!* The dust barely settles before the next move!',
    '👏 *The audience erupts!* This is what they came for!',
    '💥 *The impact echoes through the arena!* Even the Emperor leans forward!',
    '🗡️ *A masterful display of combat!* The trainers nod in approval!',
    '⚡ *The tension is palpable!* Neither warrior gives an inch!',
    '🎯 *A precise strike!* The veteran gladiators watch with respect!',
];

const ANNOUNCER_CLOSE = [
    '😮 *Barely standing...* both warriors gasp for air. The end is near!',
    '⏳ *The crowd holds its breath!* One more blow could decide it all!',
    '🔥 *Blood drips into the sand!* The next strike could be the last!',
    '⚔️ *Weapons tremble in exhausted hands!* This is the final exchange!',
];

const ANNOUNCER_FINISH = [
    '🏆 *The victor raises their weapon to the sky!* The crowd showers them with praise!',
    '👑 *The Emperor nods in approval!* A champion is crowned this day!',
    '🌹 *Roses rain down from the stands!* The arena has its winner!',
    '🎉 *The Colosseum trembles with the roar of the crowd!* Glory eternal!',
];

const DUEL_PREFIXES = ['Iron', 'Steel', 'Blood', 'Sand', 'Glory', 'Honor', 'Fury', 'Shadow', 'Storm', 'Ember', 'Fang', 'Crown', 'Blade', 'Stone', 'Thunder', 'Ash', 'Gold', 'Void', 'Flame', 'Dawn'];
const DUEL_NOUNS   = ['Clash', 'Duel', 'Trial', 'Contest', 'Bout', 'Challenge', 'Judgment', 'Reckoning', 'Proving', 'Gauntlet'];

async function handleColosseum(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;

    const activeDuels = await db.all("SELECT * FROM duels WHERE status IN ('active','pending') ORDER BY id DESC LIMIT 10");
    const myDuels = activeDuels.filter(d => d.challenger_id === userId || d.defender_id === userId);
    const myBets = await db.all('SELECT * FROM bets WHERE bettor_id=? AND payout=0 ORDER BY id DESC LIMIT 5', userId);

    const emb = new EmbedBuilder()
        .setTitle('🏟️ COLOSSEUM')
        .setColor(0xFFD700)
        .setDescription([
            `**Active Duels:** ${activeDuels.length} | **Your Duels:** ${myDuels.length} | **Your Bets:** ${myBets.length}`,
            '',
            activeDuels.length > 0 ? '**Recent Duels:**' : '',
            ...activeDuels.slice(0, 5).map(d => {
                const status = d.status === 'pending' ? '⏳ Pending' : '⚔️ Active';
                return `**${d.name || 'Duel'}** — <@${d.challenger_id}> vs <@${d.defender_id}> — ${TERRAINS[d.terrain]?.name || d.terrain} | ${status}`;
            }),
            activeDuels.length > 5 ? `...and ${activeDuels.length - 5} more` : '',
        ].join('\n'));

    const users = await db.all("SELECT id, username, ruler_name FROM users WHERE status='active' AND id!=?", userId);
    const challengeMenu = new StringSelectMenuBuilder()
        .setCustomId(`colo_challenge_${userId}`)
        .setPlaceholder('⚔️ Challenge a Player...')
        .addOptions(users.length > 0 ? users.slice(0, 25).map(u => ({
            label: `${u.ruler_name || u.username}`,
            value: u.id
        })) : [{ label: 'No players available', value: 'none' }]);

    const myDuelMenu = new StringSelectMenuBuilder()
        .setCustomId(`colo_myduels_${userId}`)
        .setPlaceholder('📋 My Duels...')
        .addOptions([
            ...(myDuels.length > 0 ? myDuels.filter(d => d.challenger_id === userId && d.status === 'pending').map(d => ({
                label: `❌ Cancel: ${d.name || 'Duel'}`,
                value: `cancel_${d.id}`,
                description: 'Retract your challenge'
            })) : []),
            ...(myDuels.length > 0 ? myDuels.slice(0, 25).map(d => ({
                label: `${d.name || 'Duel'} vs ${d.challenger_id === userId ? d.defender_id : d.challenger_id}`,
                value: `view_${d.id}`,
                description: d.status
            })) : [{ label: 'No duels', value: 'none' }]),
        ].slice(0, 25));

    const betMenu = new StringSelectMenuBuilder()
        .setCustomId(`colo_bet_${userId}`)
        .setPlaceholder('💰 Place a Bet...')
        .addOptions(activeDuels.length > 0 ? activeDuels.filter(d => d.status === 'pending' || d.status === 'active').slice(0, 25).map(d => ({
            label: `${d.name || 'Duel'}`,
            value: `bet_${d.id}`,
            description: `${TERRAINS[d.terrain]?.name || 'Plains'}`
        })) : [{ label: 'No duels to bet on', value: 'none' }]);

    return interaction.editReply({ embeds: [emb], components: [
        new ActionRowBuilder().addComponents(challengeMenu),
        new ActionRowBuilder().addComponents(myDuelMenu),
        new ActionRowBuilder().addComponents(betMenu),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`colo_history_${userId}`).setLabel('📜 History').setStyle(ButtonStyle.Secondary)
        )
    ]});
}

// ─── Select Handler ────────────────────────────────────────────────────────────

async function handleSelect(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'colo') {
        const sub = args[0];
        const uid = args[1];
        if (interaction.user.id !== uid) return ephemeralReply(interaction, '⚠️ Only the player who opened this may use it.');

        // Challenge: player selected → defender picks terrain on accept
        if (sub === 'challenge') {
            const targetId = interaction.values[0];
            if (targetId === 'none' || targetId === interaction.user.id) return ephemeralReply(interaction, '⚠️ Invalid target.');
            await interaction.deferUpdate();

            const challenger = await db.get('SELECT * FROM users WHERE id=?', uid);
            const defender = await db.get('SELECT * FROM users WHERE id=?', targetId);
            if (!defender) return interaction.editReply({ content: '⚠️ Target not found.', components: [] });

            const chp = challenger.hp_current || 10;
            const dhp = defender.hp_current || 10;
            const result = await db.run(
                "INSERT INTO duels (challenger_id, defender_id, terrain, name, challenger_hp, defender_hp, created_at) VALUES (?,?,?,?,?,?,?)",
                uid, targetId, 'PLAINS', pick(DUEL_PREFIXES) + ' ' + pick(DUEL_NOUNS), chp, dhp, Date.now()
            );
            const duelId = result.lastID;

            // Post to colosseum channel with @everyone ping
            const coloChan = await interaction.client.channels.fetch(COLOSSEUM_CHANNEL).catch(() => null);
            if (coloChan) {
                const intro = pick(ANNOUNCER_INTROS);
                // Ping all active players (not @everyone)
                const activePlayers = await db.all("SELECT id FROM users WHERE status='active'");
                const playerPings = activePlayers.map(p => `<@${p.id}>`).join(' ');
                await coloChan.send({ content: `🏟️ ${intro}\n\n${playerPings}` });
                await coloChan.send({ embeds: [new EmbedBuilder().setTitle('🏟️ NEW DUEL').setColor(0xFFD700)
                    .setImage(ENTRY_GIF)
                    .setDescription([
                        `**${pick(DUEL_PREFIXES) + ' ' + pick(DUEL_NOUNS)}**`,
                        `⚔️ Challenger: ${challenger.ruler_name || challenger.username}\n${hpBar(chp)} (${chp} HP)`,
                        `🛡️ Defender: ${defender.ruler_name || defender.username}\n${hpBar(dhp)} (${dhp} HP)`,
                        `🌍 Arena: **to be picked by defender on accept**`,
                        ``,
                        `**Bet now!** Use \`/atlas colosseum\` → Place Bet before stances lock.`,
                    ].join('\n'))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`colo_accept_${duelId}`).setLabel('⚔️ Accept & Pick Terrain').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`colo_reject_${duelId}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
                    )]
                });
            }

            // DM defender
            await sendToPlayer(interaction.client, interaction, targetId, {
                embeds: [new EmbedBuilder().setTitle('🏟️ DUEL CHALLENGE').setColor(0xFFD700)
                    .setDescription(`<@${uid}> challenges you to a duel! **Accept and you pick the arena terrain.**`)]
            });

            return interaction.editReply({ content: `🏟️ Duel created! Challenged <@${targetId}> to **${pick(DUEL_PREFIXES) + ' ' + pick(DUEL_NOUNS)}**. Defender will pick terrain on acceptance.`, components: [] });
        }

        // Terrain picked by defender → activate duel
        if (sub === 'terrain') {
            const duelId = parseInt(args[2]);
            const terrain = interaction.values[0];
            const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
            if (!duel || duel.status !== 'pending') return ephemeralReply(interaction, '⚠️ Duel no longer available.');
            if (interaction.user.id !== duel.defender_id) return ephemeralReply(interaction, '⚠️ Only the defender may pick terrain.');

            await db.run("UPDATE duels SET terrain=?, status='active' WHERE id=?", terrain, duelId);
            await ephemeralReply(interaction, `✅ Terrain set to **${TERRAINS[terrain]?.name || terrain}**. The duel begins!`);

            // Post odds to colosseum
            const challenger = await db.get('SELECT * FROM users WHERE id=?', duel.challenger_id);
            const defender   = await db.get('SELECT * FROM users WHERE id=?', duel.defender_id);
            const challengerPower = getStatSum(challenger);
            const defenderPower = getStatSum(defender);
            const challengerOdds = Math.max(0.3, Math.min(3.0, defenderPower / Math.max(1, challengerPower)));
            const defenderOdds = Math.max(0.3, Math.min(3.0, challengerPower / Math.max(1, defenderPower)));

            const coloChan = await interaction.client.channels.fetch(COLOSSEUM_CHANNEL).catch(() => null);
            if (coloChan) {
                await coloChan.send({ embeds: [new EmbedBuilder().setTitle('🏟️ DUEL ACTIVE').setColor(0xFFD700)
                    .setImage(VS_GIF)
                    .setDescription([
                        `**${duel.name}** — <@${duel.challenger_id}> vs <@${duel.defender_id}>`,
                        `🌍 Arena: **${TERRAINS[terrain]?.name || terrain}**`,
                        `⚔️ Odds: Challenger **${challengerOdds.toFixed(1)}x** | Defender **${defenderOdds.toFixed(1)}x**`,
                    ].join('\n'))]
                });
            }

            // Send stance pick to both players
            for (const uid of [duel.challenger_id, duel.defender_id]) {
                const stanceMenu = new StringSelectMenuBuilder()
                    .setCustomId(`colo_stance_${uid}_${duel.id}_${uid === duel.challenger_id ? 'c' : 'd'}`)
                    .setPlaceholder('Round 1 — Pick Stance...')
                    .addOptions(Object.entries(DUEL_STANCES).map(([k, v]) => ({ label: `${v.emoji} ${v.name}`, value: k, description: v.desc })));
                const userHp = uid === duel.challenger_id ? duel.challenger_hp : duel.defender_hp;
                await sendToPlayer(interaction.client, interaction, uid, {
                    embeds: [new EmbedBuilder().setTitle('⚔️ Pick Stance').setColor(0xFFD700)
                        .setDescription(`Arena: **${TERRAINS[terrain]?.name || terrain}**\n${hpBar(userHp)} (${userHp} HP)\nPick your stance:`)],
                    components: [new ActionRowBuilder().addComponents(stanceMenu)]
                });
            }

            return;
        }

        // My Duels: view details or start round
        if (sub === 'myduels') {
            const val = interaction.values[0];
            if (val === 'none') return ephemeralReply(interaction, 'No duels found.');
            if (val.startsWith('cancel_')) {
                const duelId = parseInt(val.replace('cancel_', ''));
                const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
                if (!duel || duel.challenger_id !== uid) return ephemeralReply(interaction, '⚠️ Only the challenger may cancel.');
                if (duel.status === 'completed') return ephemeralReply(interaction, '⚠️ Duel already completed.');
                await db.run("UPDATE duels SET status='rejected' WHERE id=?", duelId);
                await ephemeralReply(interaction, `❌ **${duel.name || 'Duel'}** cancelled.`);
                return;
            }
            const duelId = parseInt(val.replace('view_', ''));
            const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
            if (!duel) return ephemeralReply(interaction, 'Duel not found.');
            await interaction.deferUpdate();

            if (duel.status === 'pending')
                return interaction.editReply({ content: `**${duel.name}** awaiting acceptance from <@${duel.defender_id}>.`, components: [] });
            if (duel.status === 'completed')
                return interaction.editReply({ content: `**${duel.name}** concluded. Winner: <@${duel.winner_id}>.`, components: [] });

            // Active duel — show stance pick if it's your turn
            if (duel.round === 0 || (duel.challenger_stance && duel.defender_stance)) {
                // Both submitted (or first round) → show stance pick
                const isChallenger = uid === duel.challenger_id;
                const stanceMenu = new StringSelectMenuBuilder()
                    .setCustomId(`colo_stance_${uid}_${duel.id}_${isChallenger ? 'c' : 'd'}`)
                    .setPlaceholder(`Round ${duel.round + 1} — Pick Stance...`)
                    .addOptions(Object.entries(DUEL_STANCES).map(([k, v]) => ({
                        label: `${v.emoji} ${v.name}`,
                        value: k,
                        description: v.desc
                    })));
                return interaction.editReply({ embeds: [duelEmbed(duel, uid)],
                    components: [new ActionRowBuilder().addComponents(stanceMenu)] });
            }
            return interaction.editReply({ content: `**${duel.name}**: Waiting for opponent's stance...`, components: [] });
        }

        // Bet: select duel → enter amount modal
        if (sub === 'bet') {
            const uid = interaction.user.id;
            const val = interaction.values[0];
            if (val === 'none') return ephemeralReply(interaction, 'No duels to bet on.');
            const duelId = parseInt(val.replace('bet_', ''));
            const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
            if (!duel || duel.status === 'completed') return ephemeralReply(interaction, 'Duel not available for betting.');
            if (uid === duel.challenger_id || uid === duel.defender_id) return ephemeralReply(interaction, '⚠️ Cannot bet on your own duel.');

            const modal = new ModalBuilder().setCustomId(`colo_betmod_${duelId}_${uid}`).setTitle('💰 Place Bet');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel('Amount (:coin:)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('100')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bet_on').setLabel('Bet on (c=challenger, d=defender)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('c'))
            );
            return await interaction.showModal(modal);
        }

        // Stance pick during active duel
        if (sub === 'stance') {
            const duelId = parseInt(args[2]);
            const role = args[3]; // 'c' or 'd'
            const chosenStance = interaction.values[0];
            return await handleStanceSelect(interaction, duelId, role, chosenStance);
        }
    }
}

// ─── Modal Handler ─────────────────────────────────────────────────────────────

async function handleModal(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'colo' && args[0] === 'betmod') {
        const duelId = parseInt(args[1]);
        const uid = args[2];
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        const betOn = interaction.fields.getTextInputValue('bet_on')?.trim().toLowerCase();

        if (isNaN(amt) || amt <= 0) return ephemeralReply(interaction, '⚠️ Invalid amount.');
        if (!['c', 'd'].includes(betOn)) return ephemeralReply(interaction, "⚠️ Use 'c' for challenger, 'd' for defender.");

        const user = await db.get('SELECT balance FROM users WHERE id=?', uid);
        const maxBet = Math.floor((user.balance || 0) * 0.10);
        if (amt > maxBet) return ephemeralReply(interaction, `⚠️ Max bet is 10% of balance: **${maxBet} :coin:**.`);

        const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
        if (!duel || duel.status === 'completed') return ephemeralReply(interaction, '⚠️ Duel not available.');
        if (uid === duel.challenger_id || uid === duel.defender_id) return ephemeralReply(interaction, '⚠️ Cannot bet on your own duel.');
        if (duel.challenger_stance && duel.defender_stance) return ephemeralReply(interaction, '⚠️ Bets closed — stances already locked.');

        const challenger = await db.get('SELECT * FROM users WHERE id=?', duel.challenger_id);
        const defender   = await db.get('SELECT * FROM users WHERE id=?', duel.defender_id);
        const challengerPower = getStatSum(challenger);
        const defenderPower   = getStatSum(defender);
        const odds = betOn === 'c'
            ? Math.max(0.3, Math.min(3.0, defenderPower / Math.max(1, challengerPower)))
            : Math.max(0.3, Math.min(3.0, challengerPower / Math.max(1, defenderPower)));

        await db.run('UPDATE users SET balance=balance-? WHERE id=?', amt, uid);
        await db.run('INSERT INTO bets (duel_id, bettor_id, amount, bet_on, odds, created_at) VALUES (?,?,?,?,?,?)',
            duelId, uid, amt, betOn, odds, Date.now());

        return ephemeralReply(interaction, `💰 Bet **${amt} :coin:** on **${betOn === 'c' ? 'Challenger' : 'Defender'}** at **${odds.toFixed(1)}x** odds.`);
    }
}

// ─── Button Handler ────────────────────────────────────────────────────────────

async function handleButton(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'colo') {
        const sub = args[0];

        // Accept duel → defender picks terrain
        if (sub === 'accept') {
            await interaction.deferReply({ ephemeral: true });
            const duelId = parseInt(args[1]);
            const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
            if (!duel || duel.status !== 'pending') return interaction.editReply({ content: '⚠️ Duel no longer available.' });
            if (interaction.user.id !== duel.defender_id) return interaction.editReply({ content: '⚠️ Only the defender can accept.' });

            // Show terrain pick to defender
            const terrainMenu = new StringSelectMenuBuilder()
                .setCustomId(`colo_terrain_${interaction.user.id}_${duelId}`)
                .setPlaceholder('Pick your arena terrain...')
                .addOptions(Object.entries(DUEL_TERRAIN_MODS).map(([k, v]) => ({
                    label: `${TERRAINS[k]?.name || k}`,
                    value: k,
                    description: v.desc
                })));
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🌍 Pick Arena Terrain').setColor(0xFFD700)
                .setDescription('Choose the terrain for this duel:')],
                components: [new ActionRowBuilder().addComponents(terrainMenu),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`colo_back_${interaction.user.id}`).setLabel('← Back').setStyle(ButtonStyle.Secondary))] });
        }

        // Reject duel
        if (sub === 'reject') {
            await interaction.deferReply({ ephemeral: true });
            const duelId = parseInt(args[1]);
            const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
            if (!duel || duel.status !== 'pending') return interaction.editReply({ content: '⚠️ Duel no longer available.' });
            if (interaction.user.id !== duel.defender_id && interaction.user.id !== duel.challenger_id) return interaction.editReply({ content: '⚠️ You are not part of this duel.' });
            await db.run("UPDATE duels SET status='rejected' WHERE id=?", duelId);
            await interaction.editReply({ components: [], content: '❌ Duel rejected.' });
            return;
        }

        // Rematch
        if (sub === 'rematch') {
            await interaction.deferReply({ ephemeral: true });
            const challengerId = args[1];
            const defenderId = args[2];
            if (interaction.user.id !== challengerId && interaction.user.id !== defenderId)
                return interaction.editReply({ content: '⚠️ Only duel participants may request a rematch.' });

            const challenger = await db.get('SELECT * FROM users WHERE id=?', challengerId);
            const defender   = await db.get('SELECT * FROM users WHERE id=?', defenderId);
            if (!challenger || !defender) return interaction.editReply({ content: '⚠️ Player not found.' });

            // Swap roles so loser gets to be challenger (initiator of rematch)
            const newChp = challenger.hp_current || 10;
            const newDhp = defender.hp_current   || 10;
            const result = await db.run(
                "INSERT INTO duels (challenger_id, defender_id, terrain, name, challenger_hp, defender_hp, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                challengerId, defenderId, 'PLAINS', pick(DUEL_PREFIXES) + ' ' + pick(DUEL_NOUNS) + ' (Rematch)',
                newChp, newDhp, 'pending', Date.now()
            );
            const newDuelId = result.lastID;

            // Post to colosseum
            const coloChan = await interaction.client.channels.fetch(COLOSSEUM_CHANNEL).catch(() => null);
            if (coloChan) {
                await coloChan.send({ embeds: [new EmbedBuilder().setTitle('⚔️ REMATCH REQUESTED').setColor(0xFFD700)
                    .setDescription([
                        `<@${challengerId}> has called for a rematch against <@${defenderId}>!`,
                        `⚤️ **Defender picks the terrain on acceptance.**`,
                    ].join('\n'))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`colo_accept_${newDuelId}`).setLabel('⚔️ Accept Rematch').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`colo_reject_${newDuelId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
                    )]
                });
            }
            await sendToPlayer(interaction.client, interaction, defenderId, {
                embeds: [new EmbedBuilder().setTitle('⚔️ REMATCH REQUEST').setColor(0xFFD700)
                    .setDescription(`<@${challengerId}> wants a rematch! Accept in the Colosseum channel.`)]
            });
            return interaction.editReply({ content: '⚔️ Rematch requested! Waiting for opponent.' });
        }

        // History
        if (sub === 'history') {
            await interaction.deferUpdate();
            const histUserId = interaction.user.id; // FIX: uid not defined in handleButton scope
            const duels = await db.all("SELECT * FROM duels WHERE status='completed' AND (challenger_id=? OR defender_id=?) ORDER BY id DESC LIMIT 10", histUserId, histUserId);
            const lines = duels.map(d => `**${d.name || 'Duel'}**: <@${d.challenger_id}> vs <@${d.defender_id}> — Winner: <@${d.winner_id}> | ${TERRAINS[d.terrain]?.name}`);
            return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📜 DUEL HISTORY').setColor(0xFFD700).setDescription(lines.join('\n') || 'No completed duels.')], components: [] });
        }

        // Back
        if (sub === 'back') {
            await interaction.deferUpdate();
            return handleColosseum(interaction);
        }
    }
}

// ─── Stance Resolution ─────────────────────────────────────────────────────────

async function handleStanceSelect(interaction, duelId, playerRole, chosenStance) {
    const db = interaction.client.db;
    try {
        const stance = DUEL_STANCES[chosenStance];
        if (!stance) return ephemeralReply(interaction, '⚠️ Invalid stance.');

        const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
        if (!duel || duel.status !== 'active') return ephemeralReply(interaction, '⚠️ Duel not found.');

        const uid = interaction.user.id;
        const isChallenger = playerRole === 'c';
        if (isChallenger && uid !== duel.challenger_id) return ephemeralReply(interaction, '⚠️ Only the challenger may pick.');
        if (!isChallenger && uid !== duel.defender_id) return ephemeralReply(interaction, '⚠️ Only the defender may pick.');

        // Store stance
        if (isChallenger) {
            await db.run('UPDATE duels SET challenger_stance=? WHERE id=?', chosenStance, duelId);
        } else {
            await db.run("UPDATE duels SET defender_stance=? WHERE id=?", chosenStance, duelId);
        }

        await ephemeralReply(interaction, `✅ Stance locked: **${stance.name}**. Waiting for opponent...`);

        // Check if both stances are in
        const refreshed = await db.get('SELECT * FROM duels WHERE id=?', duelId);
        if (!refreshed.challenger_stance || !refreshed.defender_stance) return;

        // Both stances locked — resolve round
        await resolveRound(db, interaction.client, refreshed, duelId);
    } catch (e) {
        console.error('[COLOSSEUM] handleStanceSelect error:', e.message);
        await safeReply(interaction, '⚠️ Something went wrong resolving the round. Please try again.');
    }
}

async function resolveRound(db, client, duel, duelId) {
    const challenger = await db.get('SELECT * FROM users WHERE id=?', duel.challenger_id);
    const defender   = await db.get('SELECT * FROM users WHERE id=?', duel.defender_id);
    if (!challenger || !defender) return;

    const cStance = DUEL_STANCES[duel.challenger_stance];
    const dStance = DUEL_STANCES[duel.defender_stance];
    const terrainMod = DUEL_TERRAIN_MODS[duel.terrain] || DUEL_TERRAIN_MODS['PLAINS'];

    // Determine winner of stance clash
    let cMult, dMult;
    if (cStance.beats === duel.defender_stance) { cMult = cStance.winMult; dMult = dStance.lossMult; }
    else if (dStance.beats === duel.challenger_stance) { cMult = cStance.lossMult; dMult = dStance.winMult; }
    else { cMult = cStance.tieMult; dMult = dStance.tieMult; }

    // Terrain modifiers
    if (terrainMod.defend && duel.challenger_stance === 'RIPOSTE') cMult *= terrainMod.defend;
    if (terrainMod.defend && duel.defender_stance === 'RIPOSTE') dMult *= terrainMod.defend;
    if (terrainMod.heavy && duel.challenger_stance === 'HEAVY') cMult *= terrainMod.heavy;
    if (terrainMod.quick && duel.challenger_stance === 'QUICK') cMult *= terrainMod.quick;
    if (terrainMod.heavy && duel.defender_stance === 'HEAVY') dMult *= terrainMod.heavy;
    if (terrainMod.quick && duel.defender_stance === 'QUICK') dMult *= terrainMod.quick;

    // Morale multiplier
    const cMoral = calcMorale(challenger) / 100;
    const dMoral = calcMorale(defender) / 100;

    // Damage calculation
    const cBase = (challenger.attr_str || 10) * 0.6 + (challenger.attr_men || 10) * 0.4;
    const dBase = (defender.attr_str || 10) * 0.6 + (defender.attr_men || 10) * 0.4;

    // CHA bonuses
    const cChaBonus = 1 + Math.max(0, getMod(challenger.attr_cha || 10)) * 0.05 + (terrainMod.chaBonus || 0) * 0.05;
    const dChaBonus = 1 + Math.max(0, getMod(defender.attr_cha || 10)) * 0.05 + (terrainMod.chaBonus || 0) * 0.05;

    // MOT tiebreaker
    let tieDamage = 0;
    if (duel.challenger_stance === duel.defender_stance) {
        const cMot = challenger.attr_mot || 10;
        const dMot = defender.attr_mot || 10;
        if (cMot > dMot) cMult += 0.1;
        else if (dMot > cMot) dMult += 0.1;
    }

    // Defense reduction
    const cDef = (challenger.attr_wis || 10) * 0.3 + (challenger.attr_mot || 10) * 0.2;
    const dDef = (defender.attr_wis || 10) * 0.3 + (defender.attr_mot || 10) * 0.2;

    // MEN critical (Heavy Attack only)
    let cCrit = false, dCrit = false;
    if (duel.challenger_stance === 'HEAVY' && Math.random() < getMod(challenger.attr_men || 10) * 0.10) cCrit = true;
    if (duel.defender_stance === 'HEAVY' && Math.random() < getMod(defender.attr_men || 10) * 0.10) dCrit = true;

    let cDmg = Math.max(1, Math.floor((cBase * cMult * cMoral * cChaBonus) - dDef)) * (cCrit ? 2 : 1);
    let dDmg = Math.max(1, Math.floor((dBase * dMult * dMoral * dChaBonus) - cDef)) * (dCrit ? 2 : 1);

    const newChp = Math.max(0, (duel.challenger_hp || 10) - dDmg);
    const newDhp = Math.max(0, (duel.defender_hp || 10) - cDmg);

    const roundWinner = cDmg > dDmg ? 'challenger' : dDmg > cDmg ? 'defender' : 'tie';
    const roundNum = (duel.round || 0) + 1;

    let winnerId = null;
    let status = 'active';
    if (newChp <= 0 && newDhp <= 0) { winnerId = cDmg >= dDmg ? duel.challenger_id : duel.defender_id; status = 'completed'; }
    else if (newChp <= 0) { winnerId = duel.defender_id; status = 'completed'; }
    else if (newDhp <= 0) { winnerId = duel.challenger_id; status = 'completed'; }

    await db.run("UPDATE duels SET challenger_hp=?, defender_hp=?, challenger_stance=NULL, defender_stance=NULL, round=?, winner_id=?, status=? WHERE id=?",
        newChp, newDhp, roundNum, winnerId, status, duelId);

    // Result embed
    const cName = challenger.ruler_name || challenger.username || 'Challenger';
    const dName = defender.ruler_name || defender.username || 'Defender';
    const roundAnnounce = pick(ANNOUNCER_ROUNDS);
    const isClose = status !== 'completed' && Math.abs(newChp - newDhp) <= 3;
    const closeAnnounce = isClose ? `\n\n${pick(ANNOUNCER_CLOSE)}` : '';

    const emb = new EmbedBuilder()
        .setTitle(`🏟️ ROUND ${roundNum} RESULT`)
        .setColor(status === 'completed' ? 0x00FF88 : 0xFFD700)
        .setImage(CLAP_GIF)
        .setDescription([
            `${cName}: ${cStance.emoji} **${cStance.name}**${cCrit ? ' 💥CRIT!' : ''} | ${dName}: ${dStance.emoji} **${dStance.name}**${dCrit ? ' 💥CRIT!' : ''}`,
            ``,
            `${cName}: **${cDmg} DMG** dealt | ${dName}: **${dDmg} DMG** dealt`,
            `**HP:**`,
            `<@${duel.challenger_id}> ${hpBar(newChp)} (${newChp})`,
            `<@${duel.defender_id}> ${hpBar(newDhp)} (${newDhp})`,
            roundWinner === 'tie' ? '⚖️ Round tied!' : `⚔️ Round winner: <@${roundWinner === 'challenger' ? duel.challenger_id : duel.defender_id}>`,
            '',
            roundAnnounce + closeAnnounce,
            status === 'completed' ? `\n🏆 **${pick(ANNOUNCER_FINISH)}** — <@${winnerId}> is victorious!` : '',
        ].join('\n'));

    // If duel not over, send plain embed now; if completed, the else block below sends with rematch button
    if (status === 'active') {
        // Post round result to colosseum + DM both players
        const coloChan = await client.channels.fetch(COLOSSEUM_CHANNEL).catch(() => null);
        if (coloChan) await coloChan.send({ embeds: [emb] });
        for (const uid of [duel.challenger_id, duel.defender_id]) {
            await sendToPlayer(client, null, uid, { embeds: [emb] });
        }
        // Send stance pick for next round
        for (const uid of [duel.challenger_id, duel.defender_id]) {
            const stanceMenu = new StringSelectMenuBuilder()
                .setCustomId(`colo_stance_${uid}_${duelId}_${uid === duel.challenger_id ? 'c' : 'd'}`)
                .setPlaceholder(`Round ${roundNum + 1} — Pick Stance...`)
                .addOptions(Object.entries(DUEL_STANCES).map(([k, v]) => ({ label: `${v.emoji} ${v.name}`, value: k, description: v.desc })));
            const userHp = uid === duel.challenger_id ? newChp : newDhp;
            await sendToPlayer(client, null, uid, {
                embeds: [new EmbedBuilder().setTitle(`⚔️ Next Round`).setColor(0xFFD700)
                    .setDescription(`${hpBar(userHp)} (${userHp} HP)\nPick your stance:`)],
                components: [new ActionRowBuilder().addComponents(stanceMenu)]
            });
        }
    } else {
        // Payout bets, then offer rematch
        await payoutBets(db, client, duelId, winnerId);
        // Add rematch button to the result embed posted to the channel
        const rematchRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`colo_rematch_${duel.challenger_id}_${duel.defender_id}`)
                .setLabel('⚔️ Rematch')
                .setStyle(ButtonStyle.Primary)
        );
        const coloChan2 = await client.channels.fetch(COLOSSEUM_CHANNEL).catch(() => null);
        if (coloChan2) await coloChan2.send({ embeds: [emb], components: [rematchRow] });
        // DM both players with rematch option
        for (const uid of [duel.challenger_id, duel.defender_id]) {
            await sendToPlayer(client, null, uid, { embeds: [emb], components: [rematchRow] });
        }
        return; // already sent embed above, skip the duplicate send below
    }
}

async function payoutBets(db, client, duelId, winnerId) {
    const duel = await db.get('SELECT * FROM duels WHERE id=?', duelId);
    const bets = await db.all('SELECT * FROM bets WHERE duel_id=? AND payout=0', duelId);
    for (const b of bets) {
        const won = (b.bet_on === 'c' && winnerId === duel.challenger_id) || (b.bet_on === 'd' && winnerId === duel.defender_id);
        const payout = won ? Math.floor(b.amount * b.odds) : 0;
        const houseCut = won ? 0 : Math.floor(b.amount * 0.05);
        await db.run('UPDATE bets SET payout=? WHERE id=?', payout, b.id);
        if (payout > 0) {
            await db.run('UPDATE users SET balance=balance+? WHERE id=?', payout, b.bettor_id);
        }
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getStatSum(user) {
    return (user.attr_str || 10) + (user.attr_mot || 10) + (user.attr_men || 10)
         + (user.attr_int || 10) + (user.attr_wis || 10) + (user.attr_cha || 10);
}

function duelEmbed(duel, uid) {
    return new EmbedBuilder().setTitle(`🏟️ ${duel.name || 'Duel'}`).setColor(0xFFD700)
        .setDescription([
            `**Arena:** ${TERRAINS[duel.terrain]?.name || duel.terrain}`,
            `**Round:** ${(duel.round || 0) + 1}`,
            `**HP:**`,
            `<@${duel.challenger_id}> ${hpBar(duel.challenger_hp)} (${duel.challenger_hp})`,
            `<@${duel.defender_id}> ${hpBar(duel.defender_hp)} (${duel.defender_hp})`,
            '',
            'Pick your stance below:',
        ].join('\n'));
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

module.exports = { handleColosseum, handleSelect, handleModal, handleButton };
