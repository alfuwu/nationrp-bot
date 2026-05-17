const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { ARMY_TYPES, MERC_DESC, TERRAINS, FORMATIONS, BUILDINGS, ANCESTRIES } = require('../../data/constants');
const { getMod, getPlayerRank, calcMaintenance, calcMorale } = require('../../utils/helpers');

async function handleMilitary(interaction) {
    const db = interaction.client.db;
    const userId = interaction.user.id;
    const user = await db.get('SELECT * FROM users WHERE id=?', userId);

    const emb = new EmbedBuilder()
        .setTitle('⚔️ MILITARY COMMAND')
        .setColor(0xFF4400)
        .setDescription([
            'Select a military operation:',
            '',
            `🕵️ **Scout** — Gather intel on enemy settlements`,
            `⚔️ **Recruit** — Conscript forces from your population`,
            `⚔️ **Battle** — Declare field battle (Dominar+)`,
            `🏰 **Siege** — Lay siege to a settlement (Sovereign)`,
            `🗡️ **Raid** — Hit-and-run raid (Dominar+)`,
            '',
            `Your army: ⚔️Inf ${user.mil_infantry||0} 🐎Cav ${user.mil_cavalry||0} 🏹Rng ${user.mil_ranged||0} 🪨Sie ${user.mil_siege||0} 🗡️Merc ${user.mercs_temp||0}`,
            `Food: ${user.food_surplus||0} 🥩 | Morale: ${calcMorale(user)}`,
        ].join('\n'));

    const actionMenu = new StringSelectMenuBuilder()
        .setCustomId(`mil_action_${userId}`)
        .setPlaceholder('Choose a military action...')
        .addOptions([
            { label: '🕵️ Scout Enemy', value: 'scout', description: 'Gather intel on a settlement' },
            { label: '⚔️ Recruit Units', value: 'recruit', description: 'Conscript forces' },
            { label: '⚔️ Field Battle', value: 'battle', description: 'Declare open battle (Dominar+)' },
            ...(user.nation ? [{ label: '🏰 Lay Siege', value: 'siege', description: 'Siege a town (Sovereign only)' }] : []),
            { label: '🗡️ Raid', value: 'raid', description: 'Hit-and-run raid (Dominar+)' }
        ]);

    return interaction.editReply({ embeds: [emb], components: [
        new ActionRowBuilder().addComponents(actionMenu)
    ]});
}


// ─── Select handler ────────────────────────────────────────────────────────────

async function handleSelect(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'mil') {
        const sub = args[0];
        const uid = args[1];
        if (interaction.user.id !== uid) return interaction.reply({ content: '⚠️ Only the commander may use this.', ephemeral: true });

        if (sub === 'action') {
            const choice = interaction.values[0];
            if (choice === 'scout') return await showScoutTargets(interaction, uid, db);
            if (choice === 'recruit') return await showRecruitMenu(interaction, uid, db);
            if (choice === 'battle') return await showBattleTargets(interaction, uid, db);
            if (choice === 'siege') return await showSiegeTargets(interaction, uid, db);
            if (choice === 'raid') return await showRaidTargets(interaction, uid, db);
        }

        // Scout: player selected → show town select
        if (sub === 'scoutplayer') {
            const targetId = interaction.values[0];
            return await showScoutTowns(interaction, uid, targetId, db);
        }

        // Scout: town selected → show intel
        if (sub === 'scouttown') {
            await interaction.deferUpdate();
            const targetId = args[2];
            const townName = interaction.values[0];
            const targetTown = await db.get('SELECT * FROM towns WHERE user_id=? AND name=?', targetId, townName);
            if (!targetTown) return interaction.editReply({ content: '⚠️ Town not found.', components: [backRow(uid)] });

            const bldgs = await db.all('SELECT type FROM buildings WHERE town_id=?', targetTown.id);
            const bList = bldgs.map(b => `- ${BUILDINGS[b.type.toUpperCase()]?.name || b.type}`).join('\n') || '*No structures*';
            const defScore = bldgs.reduce((s, b) => {
                const bt = b.type.toUpperCase();
                if (bt === 'PALISADE') return s+1; if (bt === 'BASIC_WALL') return s+2;
                if (bt === 'ADVANCED_WALL') return s+3; if (bt === 'CASTLE') return s+5;
                return s;
            }, 0);

            const emb = new EmbedBuilder().setTitle(`🕵️ INTEL: ${targetTown.name}`).setColor(0x00BFFF)
                .setDescription(`**Owner:** <@${targetId}>\n**Terrain:** ${TERRAINS[targetTown.terrain_type]?.name || 'Unknown'}\n**Plots:** ${targetTown.plots_total}\n**Defense Score:** ${defScore}\n\n**Structures:**\n${bList}`);
            return interaction.editReply({ embeds: [emb], components: [backRow(uid)] });
        }

        // Recruit: unit type selected → show amount modal
        if (sub === 'recruittype') {
            const unitType = interaction.values[0];
            const def = ARMY_TYPES[unitType.toUpperCase()];
            if (!def && unitType.toUpperCase() !== 'MERCENARY') return interaction.reply({ content: '⚠️ Unknown unit.', ephemeral: true });

            const user = await db.get('SELECT * FROM users WHERE id=?', uid);
            if (unitType.toUpperCase() !== 'MERCENARY' && def.requires) {
                const check = await db.get('SELECT 1 FROM buildings b JOIN towns t ON b.town_id=t.id WHERE t.user_id=? AND UPPER(b.type)=? AND (b.ready_at IS NULL OR b.ready_at<=?)', uid, def.requires, Date.now());
                if (!check) return interaction.reply({ content: `⚠️ You need **${def.requires}** to recruit ${def.name}.`, ephemeral: true });
            }

            const cost = unitType.toUpperCase() === 'MERCENARY' ? 500 : def.cost_balance;
            const modal = new ModalBuilder()
                .setCustomId(`mil_recruitmod_${uid}_${unitType}`)
                .setTitle(`⚔️ Recruit ${def?.name || 'Mercenaries'}`);
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel(`Amount (${cost}:coin: each, max 10% pop)`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('10'))
            );
            return await interaction.showModal(modal);
        }

        // Battle/Siege/Raid: player selected → show composition modal (via warfare)
        if (sub === 'battleplayer') {
            const targetId = interaction.values[0];
            const atk = await db.get('SELECT * FROM users WHERE id=?', uid);
            const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
            if (!def) return interaction.reply({ content: '⚠️ Target not found.', ephemeral: true });
            const towns = await db.get('SELECT COUNT(*) as cnt FROM towns WHERE user_id=?', uid);
            const hasTown = (towns?.cnt || 0) > 0;
            if (!atk.nation && !hasTown) return interaction.reply({ content: '⚠️ You need at least a settlement to declare battle.', ephemeral: true });
            await interaction.deferUpdate();
            return await showFormationPick(interaction, uid, targetId, null, 'battle');
        }

        if (sub === 'siegplayer') {
            await interaction.deferUpdate();
            const targetId = interaction.values[0];
            const user = await db.get('SELECT * FROM users WHERE id=?', uid);
            const rank = getPlayerRank(user);
            if (rank !== 'SOVEREIGN') return interaction.editReply({ content: '⚠️ Only Sovereigns may lay siege.' });
            return await showSiegeTowns(interaction, uid, targetId, db);
        }

        if (sub === 'siegtown') {
            const targetId = args[2];
            const townName = interaction.values[0];
            await interaction.deferUpdate();
            return await showFormationPick(interaction, uid, targetId, townName, 'siege');
        }

        if (sub === 'raidplayer') {
            const targetId = interaction.values[0];
            const atk = await db.get('SELECT * FROM users WHERE id=?', uid);
            const modal = new ModalBuilder()
                .setCustomId(`warraid_${atk.id}_${targetId}`)
                .setTitle('🗡️ Commit Raid Forces');
            buildUnitModal(modal, atk);
            return await interaction.showModal(modal);
        }
    // Formation selected → show percentage modal
        if (sub === 'formation') {
            const targetId = args[2];
            const mode = args[3];
            const townName = args[4] || null;
            const formationKey = interaction.values[0];
            const formation = FORMATIONS[formationKey];
            if (!formation) return interaction.reply({ content: '⚠️ Unknown formation.', ephemeral: true });

            const atk = await db.get('SELECT * FROM users WHERE id=?', uid);

            // Validate formation unit requirements
            if (formation.reqUnit) {
                const reqCount = atk[formation.reqUnit] || 0;
                if (reqCount === 0)
                    return interaction.reply({ content: `⚠️ **${formation.name}** requires **${formation.reqName}** — you don't own any. Recruit them first via \`/atlas military\` → Recruit.`, ephemeral: true });
            }

            // Styx siege warning
            if (mode === 'siege' && townName) {
                const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
                const STYX_HOUSES = ['TYRANNITE', 'RHAGAIA', 'SELLESELA', 'GAIUS', 'CAOSSA'];
                const atkHouse = ANCESTRIES[(atk.ancestry||'').toUpperCase()]?.house;
                const defHouse = ANCESTRIES[(def?.ancestry||'').toUpperCase()]?.house;
                if (defHouse && STYX_HOUSES.includes(defHouse) && !STYX_HOUSES.includes(atkHouse)) {
                    const warnEmb = new EmbedBuilder().setTitle('⚠️ DECLARE WAR ON STYX EMPIRE').setColor(0xFF0000)
                        .setDescription([
                            `Sieging <@${targetId}> will trigger a war declaration to **ALL** Styx Empire vassals.`,
                            '',
                            `They may join to defend their ally at any time.`,
                            '',
                            'Open battles against Styx players do NOT call their allies.',
                            '',
                            '**Proceed?** Select a formation below to continue, or go Back to cancel.',
                        ].join('\n'));
                    await interaction.deferUpdate();
                    return interaction.editReply({ embeds: [warnEmb], components: [new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId(`mil_formation_${uid}_${targetId}_siege_${encode(townName)}`).setPlaceholder('Choose a formation to proceed...')
                            .addOptions(Object.entries(FORMATIONS).map(([k,f]) => ({ label: `${f.name} (${f.type})`, value: k, description: f.bonus })))
                    ), backRow(uid)] });
                }
            }

            const modal = new ModalBuilder()
                .setCustomId(`mil_formod_${uid}_${targetId}_${formationKey}_${mode}${townName ? '_' + encode(townName) : ''}`)
                .setTitle(`${FORMATIONS[formationKey].name} — Commit %`);
            buildPctUnitModal(modal, atk, mode);
            return await interaction.showModal(modal);
        }
    }
}

// ─── Modal handler ─────────────────────────────────────────────────────────────

async function handleModal(interaction, action, args) {
    const db = interaction.client.db;
    if (action === 'mil' && args[0] === 'recruitmod') {
        const uid = args[1];
        const unitType = args[2].toUpperCase();
        const amt = parseInt(interaction.fields.getTextInputValue('amt'));
        if (isNaN(amt) || amt <= 0) return interaction.reply({ content: '⚠️ Invalid amount.', ephemeral: true });

        const user = await db.get('SELECT * FROM users WHERE id=?', uid);

        if (unitType === 'MERCENARY') {
            const cost = amt * 150;
            if ((user.balance||0) < cost) return interaction.reply({ content: `⚠️ Need ${cost} :coin:.`, ephemeral: true });
            await db.run('UPDATE users SET balance=balance-?, mercs_temp=COALESCE(mercs_temp,0)+? WHERE id=?', cost, amt, uid);
            return interaction.reply({ content: `🗡️ Hired **${amt} mercenaries** for ${cost} :coin:.\n*${MERC_DESC}*`, ephemeral: true });
        }

        const def = ARMY_TYPES[unitType];
        if (!def) return interaction.reply({ content: '⚠️ Unknown unit.', ephemeral: true });

        const maxRecruits = Math.floor((user.pop_commoners||0)*0.10);
        if (amt > maxRecruits) return interaction.reply({ content: `⚠️ Max ${maxRecruits} (10% of commoners).`, ephemeral: true });

        const metCost = def.cost_met * amt;
        if (metCost > 0 && (user.metallurgy||0) < metCost) return interaction.reply({ content: `⚠️ Need ${metCost} 🔩.`, ephemeral: true });

        const balCost = def.cost_balance * amt;
        if ((user.balance||0) < balCost) return interaction.reply({ content: `⚠️ Need ${balCost} :coin:.`, ephemeral: true });

        const colMap = { MILITIA:'mil_militia', SPEARMEN:'mil_spearmen', SWORDSMAN:'mil_swordsman', SHIELD:'mil_shield', CAVALRY:'mil_cavalry', RANGED:'mil_ranged', SIEGE:'mil_siege' };
        const col = colMap[unitType];
        const updated = { ...user, [col]: (user[col]||0)+amt };
        const newMaint = calcMaintenance(updated);
        await db.run(`UPDATE users SET balance=balance-?, metallurgy=COALESCE(metallurgy,0)-?, ${col}=COALESCE(${col},0)+?, pop_commoners=pop_commoners-?, mil_maintenance_cost=? WHERE id=?`, balCost, metCost, amt, amt, newMaint, uid);

        const strMod = Math.max(0, getMod(user.attr_str||10));
        const discount = Math.min(0.30, strMod*0.01);
        const daily = Math.floor(def.food_per_unit*amt*(1-discount));
        return interaction.reply({ content: `⚔️ Recruited **${amt} ${def.name}** for ${balCost} :coin:${metCost>0?' + '+metCost+' 🔩':''}. Upkeep: ${daily} 🥩/day.`, ephemeral: true });
    }

    // Siege modal submit
    if (action === 'mil' && args[0] === 'siegemod') {
        const uid = args[1];
        const targetId = args[2];
        const townName = decode(args[3]);
        const warfare = require('./warfare');
        // Rebuild a pseudo-interaction for warfare's handler
        return await handleMilSiege(interaction, uid, targetId, townName, db, warfare);
    }

    // Formation percentage modal submit (battle/siege)
    if (action === 'mil' && args[0] === 'formod') {
        const uid = args[1];
        const targetId = args[2];
        const formationKey = args[3];
        const mode = args[4]; // 'battle' or 'siege'
        const townName = args[5] ? decode(args[5]) : null;
        return await handleFormationSubmit(interaction, uid, targetId, formationKey, mode, townName, db);
    }
}

// ─── Helper sub-views ──────────────────────────────────────────────────────────

async function showScoutTargets(interaction, uid, db) {
    await interaction.deferUpdate();
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", uid);
    if (!players.length) return interaction.editReply({ content: 'No other players to scout.', components: [] });

    const menu = new StringSelectMenuBuilder().setCustomId(`mil_scoutplayer_${uid}`).setPlaceholder('Select target player...')
        .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🕵️ SCOUT').setColor(0x00BFFF).setDescription('Select a player to scout.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showScoutTowns(interaction, uid, targetId, db) {
    await interaction.deferUpdate();
    const towns = await db.all('SELECT name FROM towns WHERE user_id=?', targetId);
    if (!towns.length) return interaction.editReply({ content: 'Target has no settlements.', components: [backRow(uid)] });

    const menu = new StringSelectMenuBuilder().setCustomId(`mil_scouttown_${uid}_${targetId}`).setPlaceholder('Select target town...')
        .addOptions(towns.slice(0,25).map(t => ({ label: t.name, value: t.name })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🕵️ SCOUT').setColor(0x00BFFF).setDescription('Select a town to scout.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showRecruitMenu(interaction, uid, db) {
    await interaction.deferUpdate();
    const user = await db.get('SELECT * FROM users WHERE id=?', uid);
    const menu = new StringSelectMenuBuilder().setCustomId(`mil_recruittype_${uid}`).setPlaceholder('Select unit type...')
        .addOptions(Object.entries(ARMY_TYPES).filter(([k]) => k !== 'CAVALRY' && k !== 'RANGED' && k !== 'SIEGE').map(([k,v]) => ({
            label: `${v.emoji} ${v.name} (${v.cost_balance}:coin: each)`,
            value: k.toLowerCase(),
            description: v.requires ? `Requires: ${v.requires}` : 'No building required'
        })).concat({ label: '🗡️ Mercenary (150:coin: each)', value: 'mercenary', description: 'Expires at turn end' }));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚔️ RECRUIT').setColor(0xFF4400)
        .setDescription(`Pop: ${user.pop_commoners||0} | Balance: ${user.balance||0} :coin: | 🔩: ${user.metallurgy||0}`)], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showBattleTargets(interaction, uid, db) {
    await interaction.deferUpdate();
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", uid);
    if (!players.length) return interaction.editReply({ content: 'No other players to battle.', components: [backRow(uid)] });
    const menu = new StringSelectMenuBuilder().setCustomId(`mil_battleplayer_${uid}`).setPlaceholder('Select target...')
        .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚔️ FIELD BATTLE').setColor(0xFF0000).setDescription('Select a player to attack. Food will be deducted on commit.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showSiegeTargets(interaction, uid, db) {
    await interaction.deferUpdate();
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", uid);
    if (!players.length) return interaction.editReply({ content: 'No other players.', components: [backRow(uid)] });
    const menu = new StringSelectMenuBuilder().setCustomId(`mil_siegplayer_${uid}`).setPlaceholder('Select target player...')
        .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏰 SIEGE').setColor(0xFF4400).setDescription('Select a player (Sovereign only). You will need to pick a town next.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showSiegeTowns(interaction, uid, targetId, db) {
    const towns = await db.all('SELECT name FROM towns WHERE user_id=?', targetId);
    if (!towns.length) return interaction.editReply({ content: 'Target has no settlements.', components: [backRow(uid)] });
    const menu = new StringSelectMenuBuilder().setCustomId(`mil_siegtown_${uid}_${targetId}`).setPlaceholder('Select target town...')
        .addOptions(towns.slice(0,25).map(t => ({ label: t.name, value: t.name })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏰 SIEGE').setColor(0xFF4400).setDescription('Select a town to siege.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

async function showRaidTargets(interaction, uid, db) {
    await interaction.deferUpdate();
    const players = await db.all("SELECT id, username, ruler_name, nation FROM users WHERE status='active' AND id!=?", uid);
    if (!players.length) return interaction.editReply({ content: 'No other players.', components: [backRow(uid)] });
    const menu = new StringSelectMenuBuilder().setCustomId(`mil_raidplayer_${uid}`).setPlaceholder('Select target...')
        .addOptions(players.slice(0,25).map(p => ({ label: `${p.ruler_name||p.username}${p.nation?' of '+p.nation:''}`, value: p.id })));
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗡️ RAID').setColor(0xFF6600).setDescription('Select a player to raid. Food deducted on commit.')], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

function backRow(uid) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mil_back_${uid}`).setLabel('← Back').setStyle(ButtonStyle.Secondary));
}

async function handleMilSiege(interaction, uid, targetId, townName, db, warfare) {
    const atk = await db.get('SELECT * FROM users WHERE id=?', uid);
    const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
    const town = await db.get('SELECT * FROM towns WHERE user_id=? AND name=?', targetId, townName);
    if (!atk || !def || !town) return interaction.reply({ content: '⚠️ Data not found.', ephemeral: true });

    const fields = ['inf','cav','rng','sie','mercs'];
    const colMap = { inf:'mil_infantry', cav:'mil_cavalry', rng:'mil_ranged', sie:'mil_siege', mercs:'mercs_temp' };
    const counts = {};
    for (const f of fields) {
        const val = parseInt(interaction.fields.getTextInputValue(f)) || 0;
        if (val < 0) return interaction.reply({ content: '⚠️ Values must be positive.', ephemeral: true });
        if (val > (atk[colMap[f]]||0)) return interaction.reply({ content: `⚠️ Cannot commit more ${f} than you own.`, ephemeral: true });
        counts[f] = val;
    }

    const foodCost = ((counts.inf||0)+(counts.cav||0)+(counts.rng||0)+(counts.sie||0)+(counts.mercs||0))*5;
    if ((atk.food_surplus||0) < foodCost) return interaction.reply({ content: `⚠️ Need ${foodCost} 🥩.`, ephemeral: true });
    await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', foodCost, uid);

    const compStr = `${counts.inf}_${counts.cav}_${counts.rng}_${counts.sie}_${counts.mercs}_${town.terrain_type}`;
    const emb = new EmbedBuilder().setTitle('🏰 SIEGE REQUEST').setColor(0xFF4400)
        .setDescription(`**Attacker:** <@${uid}> → **${town.name}** (${town.terrain_type})\n⚔️Inf ${counts.inf} 🐎Cav ${counts.cav} 🏹Rng ${counts.rng} 🪨Sie ${counts.sie}\nFood: ${foodCost} 🥩`);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`warconfirm_s_${uid}_${targetId}_${town.id}`).setLabel('✅ Confirm Siege').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`warabort_s_${uid}`).setLabel('❌ Abort').setStyle(ButtonStyle.Danger)
    );
    const { resolveAtlasHQ } = require('../../utils/helpers');
    await resolveAtlasHQ(interaction.client, emb, [row]);
    return interaction.reply({ content: `🏰 Siege submitted. ${foodCost} 🥩 spent. Awaiting GM.`, ephemeral: true });
}

function encode(s) { return (s||'').replace(/ /g, '-'); }
function decode(s) { return (s||'').replace(/-/g, ' '); }

async function handleFormationSubmit(interaction, uid, targetId, formationKey, mode, townName, db) {
    const atk = await db.get('SELECT * FROM users WHERE id=?', uid);
    const def = await db.get('SELECT * FROM users WHERE id=?', targetId);
    if (!atk || !def) return interaction.reply({ content: '⚠️ Data not found.', ephemeral: true });

    const cols = ['mil_militia','mil_spearmen','mil_swordsman','mil_shield','mil_cavalry','mil_ranged','mil_siege','mercs_temp'];
    const commits = {};
    let totalUnits = 0;
    let anyCommitted = false;
    for (const col of cols) {
        let val = 0;
        try { val = parseInt(interaction.fields.getTextInputValue(col)) || 0; } catch (_) {}
        commits[col] = Math.floor((atk[col] || 0) * Math.min(100, Math.max(0, val)) / 100);
        if (commits[col] > 0) anyCommitted = true;
        if (col !== 'mil_siege') totalUnits += commits[col];
    }
    if (!anyCommitted) return interaction.reply({ content: '⚠️ You must commit at least some forces. All percentages are 0%.', ephemeral: true });

    const foodCost = mode === 'siege' ? totalUnits * 5 : totalUnits * 2;
    if ((atk.food_surplus||0) < foodCost) return interaction.reply({ content: `⚠️ Need ${foodCost} 🥩.`, ephemeral: true });
    await db.run('UPDATE users SET food_surplus=food_surplus-? WHERE id=?', foodCost, uid);

    const compStr = `${commits.mil_militia}_${commits.mil_spearmen}_${commits.mil_swordsman}_${commits.mil_shield}_${commits.mil_cavalry}_${commits.mil_ranged}_${commits.mil_siege}_${commits.mercs_temp}_${formationKey}_${mode}`;

    const terrainKeys = Object.keys(TERRAINS);
    const terrainKey = terrainKeys[Math.floor(Math.random() * terrainKeys.length)];
    const formation = FORMATIONS[formationKey];
    const action = mode === 'siege' ? 'SIEGE' : 'BATTLE';
    const title = mode === 'siege' ? `🏰 Siege: ${townName || 'Unknown'}` : `⚔️ Battle against <@${targetId}>`;

    const emb = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xFF4400)
        .setDescription([
            `**Formation:** ${formation.name}`,
            `**Preview:**\n\`\`\`\n${formation.preview}\n\`\`\``,
            `**Bonus:** ${formation.bonus}`,
            `**Morale:** ${calcMorale(atk)} (base 100 + stability + prestige − food/servus penalties)`,
            '',
            `**Committed Forces:**`,
            `🧑 Mil:${commits.mil_militia} 🔱 Spe:${commits.mil_spearmen} ⚔️ Swd:${commits.mil_swordsman} 🛡️ Shd:${commits.mil_shield}`,
            `🐎 Cav:${commits.mil_cavalry} 🏹 Rng:${commits.mil_ranged} 🪨 Sie:${commits.mil_siege} 🗡️ Merc:${commits.mercs_temp}`,
            `🥩 Food: ${foodCost} | ❤️ Morale: ${calcMorale(atk)}`,
            '',
            `🛡️ **Defender morale:** ${def ? calcMorale(def) : '?'}`,
            '',
            `**Attacker:** ${atk.ruler_name ? `${atk.ruler_name} (@${atk.username})` : `<@${uid}>`}`,
            `**Defender:** ${def.ruler_name ? `${def.ruler_name} (@${def.username})` : `<@${targetId}>`}`,
        ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`warapprove_battle_${uid}_${targetId}_${compStr}_${terrainKey}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`warreject_battle_${uid}_${targetId}_${foodCost}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
    );

    const { resolveAtlasHQ, sendToPlayer } = require('../../utils/helpers');
    await resolveAtlasHQ(interaction.client, emb, [row]);

    // Styx War Declaration: non-Styx sieging a Styx player
    const STYX_HOUSES = ['TYRANNITE', 'RHAGAIA', 'SELLESELA', 'GAIUS', 'CAOSSA'];
    const atkHouse = ANCESTRIES[(atk.ancestry||'').toUpperCase()]?.house;
    const defHouse = ANCESTRIES[(def.ancestry||'').toUpperCase()]?.house;
    if (mode === 'siege' && !STYX_HOUSES.includes(atkHouse) && STYX_HOUSES.includes(defHouse)) {
        const styxPlayers = await db.all('SELECT id FROM users WHERE status=\'active\' AND id!=? AND id!=?', uid, targetId);
        // Filter for Styx house players
        const { ANCESTRIES: ANC } = require('../../data/constants');
        for (const sp of styxPlayers) {
            const spUser = await db.get('SELECT ancestry FROM users WHERE id=?', sp.id);
            const spHouse = ANC[(spUser?.ancestry||'').toUpperCase()]?.house;
            if (spHouse && STYX_HOUSES.includes(spHouse)) {
                await sendToPlayer(interaction.client, interaction, sp.id, {
                    embeds: [new EmbedBuilder().setTitle('⚔️ STYX EMPIRE UNDER SIEGE').setColor(0xFF0000)
                        .setDescription(`<@${uid}> (${atkHouse||'Independent'}) is laying siege to <@${targetId}> (${defHouse}) at **${townName}**.\n\nAll Styx-aligned players are called to defend the Empire.`)]
                });
            }
        }
    }

    // Formation counter info for GM
    const counterInfo = [];
    for (const [k, f] of Object.entries(FORMATIONS)) {
        if (f.counter === formationKey) counterInfo.push(`⚠️ Countered by **${f.name}**`);
        if (formationKey === f.counter) counterInfo.push(`✅ Counters **${f.name}**`);
    }
    const counterNote = counterInfo.length > 0 ? `\n\n🔄 **Formation Matchups:**\n${counterInfo.join('\n')}` : '';

    return interaction.reply({ content: `⚔️ ${mode === 'siege' ? 'Siege' : 'Battle'} submitted. ${foodCost} 🥩 spent. Awaiting GM. Formation: **${formation.name}**.${counterNote}`, ephemeral: true });
}

function showFormationPick(interaction, uid, targetId, townName, mode) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`mil_formation_${uid}_${targetId}_${mode}${townName ? '_' + encode(townName) : ''}`)
        .setPlaceholder('Choose a formation...');
    for (const [key, f] of Object.entries(FORMATIONS)) {
        let label = `${f.name} (${f.type})`;
        if (f.reqUnit && f.reqName) label += ` — needs ${f.reqName}`;
        menu.addOptions({ label, value: key, description: `${f.bonus}${f.reqUnit ? ' (unit required)' : ''}` });
    }

    // Styx siege warning
    const def = interaction.client ? null : null;
    let styxWarn = '';

    const emb = new EmbedBuilder()
        .setTitle('⚔️ Choose Formation')
        .setColor(0xFFD700)
        .setDescription(Object.entries(FORMATIONS).map(([k,f]) => {
            const req = f.reqUnit ? ` ⚠️ Requires: **${f.reqName}**` : '';
            return `**${f.name}** (${f.type}): ${f.bonus}${req}\n\`\`\`\n${f.preview}\n\`\`\``;
        }).join('\n'));
    return interaction.editReply({ embeds: [emb], components: [new ActionRowBuilder().addComponents(menu), backRow(uid)] });
}

function buildPctUnitModal(modal, user, mode) {
    const cols = ['mil_militia','mil_spearmen','mil_swordsman','mil_shield','mil_cavalry','mil_ranged','mil_siege','mercs_temp'];
    const labels = ['Militiamen','Spearmen','Swordsman','Shield Inf.','Cavalry','Ranged','Siege','Mercenaries'];
    let added = 0;
    for (let i = 0; i < cols.length; i++) {
        const max = user[cols[i]] || 0;
        if (max === 0 && cols[i] !== 'mercs_temp') continue;
        if (added >= 5) break;
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(cols[i]).setLabel(`${labels[i]} (${max})`).setStyle(TextInputStyle.Short).setRequired(false).setValue('0').setPlaceholder('0-100%')
        ));
        added++;
    }
}

function buildUnitModal(modal, user) {
    const cols = ['mil_militia','mil_spearmen','mil_swordsman','mil_shield','mil_cavalry','mil_ranged','mil_siege','mercs_temp'];
    const labels = ['Militiamen','Spearmen','Swordsman','Shield Inf.','Cavalry','Ranged','Siege','Mercenaries'];
    let added = 0;
    for (let i = 0; i < cols.length; i++) {
        const max = user[cols[i]] || 0;
        if (max === 0 && added > 0) continue;
        if (added >= 5) break;
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(cols[i]).setLabel(`${labels[i]} (max ${max})`).setStyle(TextInputStyle.Short).setRequired(false).setValue('0').setPlaceholder(`0-${max}`)
        ));
        added++;
    }
}

module.exports = { handleMilitary, handleSelect, handleModal };
