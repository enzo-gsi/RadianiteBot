const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    SlashCommandBuilder 
} = require('discord.js');
const cron = require('node-cron');
const { knex } = require('./database.js'); 
const axios = require('axios'); 

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1436123733197590624';
const HENRIK_API_KEY = process.env.HENRIK_API_KEY;
const YOUR_WEBSITE_URL = (process.env.WEBSITE_URL || "https://radianitedb.lol").replace(/\/$/, "");
const LOGO_ICON_URL = `${YOUR_WEBSITE_URL}/apple-touch-icon.png`;

// Verified official agent display icons & map splashes from valorant-api.com
const AGENT_ASSETS = {
    'jett': 'https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png',
    'reyna': 'https://media.valorant-api.com/agents/a3bfb853-43b2-7238-a4f1-ad90e9e46bcc/displayicon.png',
    'omen': 'https://media.valorant-api.com/agents/8e253930-4c05-31dd-1b6c-968525494517/displayicon.png',
    'raze': 'https://media.valorant-api.com/agents/f94c3b30-42be-e959-889c-5aa313dba261/displayicon.png',
    'sova': 'https://media.valorant-api.com/agents/ded3520f-4264-bfed-162d-a080e2def56f/displayicon.png',
    'viper': 'https://media.valorant-api.com/agents/707eab51-4836-f488-046a-cda6bf494859/displayicon.png',
    'cypher': 'https://media.valorant-api.com/agents/11738c49-42fb-ab44-c090-26ab54546c10/displayicon.png',
    'killjoy': 'https://media.valorant-api.com/agents/1e58de9c-4950-5125-93e9-a0aee9f98746/displayicon.png',
    'phoenix': 'https://media.valorant-api.com/agents/eb93336a-449b-9c1b-0a54-a891f7921d69/displayicon.png',
    'sage': 'https://media.valorant-api.com/agents/569fdd95-4d10-43ab-ca70-79becc718b46/displayicon.png',
    'brimstone': 'https://media.valorant-api.com/agents/9f0d8ba9-42c6-9247-eb5e-5c9a77d1ee34/displayicon.png',
    'breach': 'https://media.valorant-api.com/agents/5f8d3d7f-467b-97f3-062c-dd4eb030c058/displayicon.png',
    'skye': 'https://media.valorant-api.com/agents/6f2a04ca-43e0-be17-7f36-b39086d3548b/displayicon.png',
    'yoru': 'https://media.valorant-api.com/agents/7f94d92c-4234-041a-72f4-a8a074423637/displayicon.png',
    'astra': 'https://media.valorant-api.com/agents/41fb69c1-4153-7b72-d944-9a625dc73269/displayicon.png',
    'kay/o': 'https://media.valorant-api.com/agents/601dbbe7-43ce-be57-2a40-4abd24953621/displayicon.png',
    'chamber': 'https://media.valorant-api.com/agents/22697a3d-45bf-8dd7-4fec-84a9e28c69d7/displayicon.png',
    'neon': 'https://media.valorant-api.com/agents/bb2a483e-4654-8025-bbe7-56a9394fa50f/displayicon.png',
    'fade': 'https://media.valorant-api.com/agents/dade69b4-4f5a-8528-247b-219e5a1facd6/displayicon.png',
    'harbor': 'https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png',
    'gekko': 'https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png',
    'deadlock': 'https://media.valorant-api.com/agents/cc8b64d8-4b25-4ff9-6e7f-37b4da43c235/displayicon.png',
    'iso': 'https://media.valorant-api.com/agents/0e38b510-41a8-5780-5e8f-568b2a4f2d6c/displayicon.png',
    'clove': 'https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-ffbceddda528/displayicon.png',
    'vyse': 'https://media.valorant-api.com/agents/efba5359-4016-a1e5-7626-b1ae76895940/displayicon.png'
};

const MAP_SPLASHES = {
    'ascent': 'https://media.valorant-api.com/maps/7eae3437-467b-4f05-83f3-8f96e05eef33/splash.png',
    'bind': 'https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/splash.png',
    'haven': 'https://media.valorant-api.com/maps/2bee0c3d-4c47-8923-464e-388742c5ef73/splash.png',
    'split': 'https://media.valorant-api.com/maps/d960549e-485c-68e3-6170-71e5082f057e/splash.png',
    'icebox': 'https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279579a/splash.png',
    'breeze': 'https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/splash.png',
    'fracture': 'https://media.valorant-api.com/maps/b5297e25-4572-4ec4-8e58-00c0036e29a5/splash.png',
    'pearl': 'https://media.valorant-api.com/maps/fd2679d4-42f6-ddc3-4f08-4627d377c96f/splash.png',
    'lotus': 'https://media.valorant-api.com/maps/2fe4fb3d-4532-520f-af88-8cbd455d2b86/splash.png',
    'sunset': 'https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9fac-be630f727a47/splash.png',
    'abyss': 'https://media.valorant-api.com/maps/224b0c95-4d94-b14e-7bf0-388d45ba2e92/splash.png'
};

// --- Internationalization / Translations Dictionary ---
const I18N = {
    en: {
        player_profile: 'Player Profile',
        match_report: 'Match Report',
        region: 'Region',
        combat_score: 'Score',
        current_rank: '◈ Rank',
        kd_ratio: '◈ K/D Ratio',
        win_rate: '◈ Win Rate',
        acs_adr: '◈ ACS / ADR',
        precision: '◈ Headshot %',
        top_agent: '◈ Top Agent',
        played_agent: '◈ Agent Played',
        kda: '◈ K / D / A',
        mmr_change: '◈ RR Change',
        matches: 'matches',
        wins: 'wins',
        view_full: 'View Full Stats & Matches',
        open_site: 'Open RadianiteDB',
        victory: 'VICTORY',
        defeat: 'DEFEAT',
        rank_up_title: '★ RANK UP // PROMOTED TO',
        rank_up_banner: 'Congratulations! Promoted to',
        updated: 'Updated',
        footer: 'RadianiteDB • Official Valorant Analytics',
        match_ended: 'finished a match on',
        rank_up_msg: 'just RANKED UP to',
        channel_set: '✓ Notifications channel set to',
        lang_set: '✓ Bot language set to **English**.',
        followed_success: '✓ Now tracking',
        unfollowed_success: '✓ Stopped tracking',
        no_followed: 'You are not tracking any players yet. Use `/suivre Player#TAG` to add one.',
        tracking_list: 'Tracked Players List'
    },
    fr: {
        player_profile: 'Profil du Joueur',
        match_report: 'Rapport de Match',
        region: 'Région',
        combat_score: 'Score',
        current_rank: '◈ Rang Actuel',
        kd_ratio: '◈ Ratio K/D',
        win_rate: '◈ Taux de Victoire',
        acs_adr: '◈ ACS / ADR',
        precision: '◈ % Tirs Tête',
        top_agent: '◈ Agent Principal',
        played_agent: '◈ Agent Joué',
        kda: '◈ K / D / A',
        mmr_change: '◈ Évolution RR',
        matches: 'matchs',
        wins: 'victoires',
        view_full: 'Voir les 100+ Matchs & Stats complètes',
        open_site: 'Ouvrir RadianiteDB',
        victory: 'VICTOIRE',
        defeat: 'DÉFAITE',
        rank_up_title: '★ RANK UP // PROMOTION EN',
        rank_up_banner: 'Félicitations ! Promotion en',
        updated: 'Mis à jour',
        footer: 'RadianiteDB • Statistiques Officielles Valorant',
        match_ended: 'a terminé sa partie sur',
        rank_up_msg: 'vient de RANK UP en',
        channel_set: '✓ Les notifications seront désormais envoyées dans',
        lang_set: '✓ Langue du bot définie sur **Français**.',
        followed_success: '✓ Vous suivez maintenant',
        unfollowed_success: '✓ Vous ne suivez plus',
        no_followed: 'Vous ne suivez aucun joueur pour le moment. Utilisez `/suivre Pseudo#TAG`.',
        tracking_list: 'Liste des Joueurs Suivis'
    }
};

function getT(lang = 'en') {
    return I18N[lang] || I18N.en;
}

const henrikApi = axios.create({
    baseURL: 'https://api.henrikdev.xyz',
    headers: { 'Authorization': HENRIK_API_KEY },
    timeout: 15000
});

const localApi = axios.create({
    baseURL: YOUR_WEBSITE_URL,
    timeout: 15000
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// --- Définition des Commandes Slash ---
const slashCommands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Display full Valorant stats and rank for any player.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Riot ID format: Name#TAG (e.g. TenZ#SEN)')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('suivre')
        .setDescription('Track a player and receive live match notifications.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Riot ID format: Name#TAG (e.g. TenZ#SEN)')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('neplus-suivre')
        .setDescription('Stop tracking a player.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Riot ID format: Name#TAG')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('suivis')
        .setDescription('View the list of players you are currently tracking.'),

    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the text channel where the bot sends match alerts.')
        .addChannelOption(opt => 
            opt.setName('salon')
               .setDescription('Target text channel')
               .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('language')
        .setDescription('Set bot language (English / Français).')
        .addStringOption(opt =>
            opt.setName('lang')
               .setDescription('Choose language / Choisissez la langue')
               .setRequired(true)
               .addChoices(
                   { name: 'English', value: 'en' },
                   { name: 'Français', value: 'fr' }
               )
        ),

    new SlashCommandBuilder()
        .setName('aide')
        .setDescription('Show help guide and commands overview.')
].map(cmd => cmd.toJSON());

// Enregistrement des commandes Slash
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN || '');

client.once('ready', async () => {
    console.log(`[RadianiteBot] Connecté en tant que ${client.user.tag} !`);
    try {
        console.log('[RadianiteBot] Déploiement des commandes Slash...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: slashCommands },
        );
        console.log('[RadianiteBot] Commandes Slash enregistrées avec succès !');
    } catch (error) {
        console.error('[RadianiteBot] Erreur lors de l\'enregistrement des commandes Slash :', error);
    }

    // Cron job de surveillance toutes les 3 minutes
    cron.schedule('*/3 * * * *', () => {
        checkFollowedPlayers();
    });
    
    // Première vérification 10s après démarrage
    setTimeout(checkFollowedPlayers, 10000);
});

// --- Traitement des Commandes Slash ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const discord_id = interaction.user.id;

    async function getDbUser() {
        return await knex('users').where({ discord_id: String(discord_id) }).first();
    }

    const dbUser = await getDbUser();
    const userLang = dbUser?.language || 'en';
    const t = getT(userLang);

    // 1. /setchannel
    if (commandName === 'setchannel') {
        const channel = interaction.options.getChannel('salon') || interaction.channel;
        
        try {
            await interaction.deferReply({ ephemeral: true });
            let user = dbUser;

            if (!user) {
                const [inserted] = await knex('users').insert({
                    discord_id: String(discord_id),
                    username: interaction.user.tag,
                    discord_channel_id: String(channel.id)
                }).returning('*');
                user = inserted;
            } else {
                await knex('users').where({ discord_id: String(discord_id) }).update({
                    discord_channel_id: String(channel.id)
                });
            }

            await interaction.editReply({ 
                content: `${t.channel_set} <#${channel.id}>.` 
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Error saving notification channel.' });
        }
    }

    // 2. /language
    else if (commandName === 'language') {
        const newLang = interaction.options.getString('lang') === 'fr' ? 'fr' : 'en';
        try {
            await interaction.deferReply({ ephemeral: true });
            let user = dbUser;
            if (!user) {
                await knex('users').insert({
                    discord_id: String(discord_id),
                    username: interaction.user.tag,
                    language: newLang
                });
            } else {
                await knex('users').where({ discord_id: String(discord_id) }).update({
                    language: newLang
                });
            }
            const newT = getT(newLang);
            await interaction.editReply({ content: newT.lang_set });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Error updating language setting.' });
        }
    }

    // 3. /suivis
    else if (commandName === 'suivis') {
        try {
            await interaction.deferReply({ ephemeral: true });
            let user = dbUser;

            if (!user) {
                return await interaction.editReply({ content: t.no_followed });
            }

            const followed = await knex('followed_players')
                .where({ user_id: user.id })
                .select('riot_id');

            if (followed.length === 0) {
                return await interaction.editReply({ content: t.no_followed });
            }

            const playerListStr = followed.map((p, i) => `**${i + 1}.** [${p.riot_id}](${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(p.riot_id)})`).join('\n');

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: `RadianiteDB • ${t.tracking_list}`, 
                    iconURL: LOGO_ICON_URL
                })
                .setTitle(`${followed.length} Player(s) Tracked`)
                .setColor(0x00F5D4)
                .setDescription(playerListStr)
                .setFooter({ text: t.footer, iconURL: LOGO_ICON_URL })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(t.open_site)
                    .setStyle(ButtonStyle.Link)
                    .setURL(YOUR_WEBSITE_URL)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Error fetching tracked players list.' });
        }
    }

    // 4. /stats
    else if (commandName === 'stats') {
        const rawInput = interaction.options.getString('joueur');
        if (!rawInput.includes('#')) {
            return await interaction.reply({ content: '❌ Invalid format. Please include Riot Tag (e.g. `TenZ#SEN`).', ephemeral: true });
        }

        const [name, tag] = rawInput.trim().split('#');

        try {
            await interaction.deferReply();

            const statsRes = await localApi.get(`/api/stats/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
            const data = statsRes.data;

            // 1. Isolate CURRENT ACT statistics (exclude older acts)
            const availableActs = data.availableActs || [];
            const currentActObj = availableActs.find(a => a.id !== 'all' && a.count > 0) || availableActs[1] || availableActs[0];
            const actId = currentActObj ? currentActObj.id : 'all';
            const actName = currentActObj ? currentActObj.name : (lang === 'fr' ? 'ACTE ACTUEL' : 'CURRENT ACT');
            const actStats = (data.statsByAct && data.statsByAct[actId]) || data;

            const pInfo = data.playerInfo || {};
            const rInfo = data.rankInfo || {};
            const overview = actStats.overviewStats || actStats;
            const analysis = actStats.analysis || data.analysis || {};

            const rankName = rInfo.rankName || 'Unranked';
            const rr = rInfo.rr || 0;
            const kd = overview.kd || '0.00';
            const winRate = overview.winRate || 0;
            const acs = overview.acs || '0';
            const adr = overview.adr || '0';
            const hs = overview.hsPercent || '0';
            const score = overview.statsScore || 0;
            const gamesCount = overview.gameCount || 0;
            const winsCount = Math.round((winRate / 100) * gamesCount);

            // 2. Select Best Agent & Best Map with >= 3 matches threshold
            let bestAgentStr = 'None (Min 3m)';
            const allAgentsList = analysis.allAgents || [];
            const eligibleAgents = allAgentsList.filter(a => (a.count || 0) >= 3);
            const chosenAgent = eligibleAgents.length > 0 ? eligibleAgents[0] : (analysis.agents?.best || allAgentsList[0]);
            if (chosenAgent && chosenAgent.name) {
                bestAgentStr = `${chosenAgent.name} (${chosenAgent.winRate ? chosenAgent.winRate.toFixed(0) : 0}% • ${chosenAgent.count || 0}m)`;
            }

            let bestMapStr = 'None (Min 3m)';
            const allMapsList = analysis.allMaps || [];
            const eligibleMaps = allMapsList.filter(m => (m.count || 0) >= 3);
            const chosenMap = eligibleMaps.length > 0 ? eligibleMaps[0] : (analysis.maps?.best || allMapsList[0]);
            if (chosenMap && chosenMap.name) {
                bestMapStr = `${chosenMap.name} (${chosenMap.winRate ? chosenMap.winRate.toFixed(0) : 0}% • ${chosenMap.count || 0}m)`;
            }

            const tierNum = (rInfo.tier !== undefined && rInfo.tier !== null) ? rInfo.tier : 18;
            const rrNum = rInfo.rr || 0;
            const lastChangeNum = rInfo.lastRRChange || 0;

            // 3. High-resolution Rank Wheel graphic for maximum embed width
            const rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?tier=${tierNum}&rr=${rrNum}&change=${lastChangeNum}&size=420&v=4&t=${Date.now()}`;
            
            // Equipped In-Game Player Card Banner / Thumbnail
            const playerCardThumbnail = pInfo.cardSmall || pInfo.avatarUrl || pInfo.cardLarge || LOGO_ICON_URL;

            // 4. Ultra-clean Tactical HUD Embed (Natural scaling, zero word-wrap clipping)
            const embed = new EmbedBuilder()
                .setAuthor({
                    name: `RadianiteDB • ${t.player_profile}`,
                    iconURL: LOGO_ICON_URL
                })
                .setTitle(`${pInfo.name || rawInput}  •  LVL ${pInfo.level || 1}`)
                .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(rawInput)}`)
                .setColor(score >= 600 ? 0x00F5D4 : 0xFF4655)
                .setThumbnail(playerCardThumbnail)
                .setDescription(`🏆 **${actName.toUpperCase()}** • ${t.region}: **${pInfo.region || 'EU'}** • ${t.combat_score}: **${score} / 1000** ⚡`)
                .addFields(
                    { name: `🎖️ ${t.current_rank}`, value: `**${rankName}**\n(${rr} RR)`, inline: true },
                    { name: `🎯 ${t.kd_ratio}`, value: `**${kd} K/D**\n(${gamesCount} ${t.matches})`, inline: true },
                    { name: `📈 ${t.win_rate}`, value: `**${winRate}%**\n(${winsCount} ${t.wins})`, inline: true },
                    { name: `⚡ ${t.acs_adr}`, value: `**${acs} ACS**\n(${adr} ADR)`, inline: true },
                    { name: `🎯 ${t.precision}`, value: `**${hs}% HS**\nPrecision`, inline: true },
                    { name: `👤 ${t.top_agent}`, value: `**${chosenAgent?.name || 'None'}**\n(${chosenAgent?.winRate ? chosenAgent.winRate.toFixed(0) : 0}% • ${chosenAgent?.count || 0}m)`, inline: true }
                )
                .setImage(rankWheelUrl)
                .setFooter({ text: `${t.footer} • ${actName}`, iconURL: LOGO_ICON_URL })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(t.view_full)
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(rawInput)}`),
                new ButtonBuilder()
                    .setLabel(t.open_site)
                    .setStyle(ButtonStyle.Link)
                    .setURL(YOUR_WEBSITE_URL)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: `❌ Unable to fetch statistics for **${rawInput}**. Please verify spelling and Riot tag.` });
        }
    }

    // 5. /suivre
    else if (commandName === 'suivre') {
        const rawInput = interaction.options.getString('joueur');
        if (!rawInput.includes('#')) {
            return await interaction.reply({ content: '❌ Invalid format. Example: `/suivre TenZ#SEN`', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });
            let user = dbUser;

            if (!user) {
                const [inserted] = await knex('users').insert({
                    discord_id: String(discord_id),
                    username: interaction.user.tag,
                    discord_channel_id: String(interaction.channelId)
                }).returning('*');
                user = inserted;
            }

            const existing = await knex('followed_players')
                .where({ user_id: user.id, riot_id: rawInput.trim() })
                .first();

            if (!existing) {
                await knex('followed_players').insert({
                    user_id: user.id,
                    riot_id: rawInput.trim()
                });
            }

            await interaction.editReply({ 
                content: `${t.followed_success} **${rawInput.trim()}** !` 
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Error adding player to tracking list.' });
        }
    }

    // 6. /neplus-suivre
    else if (commandName === 'neplus-suivre') {
        const rawInput = interaction.options.getString('joueur');
        try {
            await interaction.deferReply({ ephemeral: true });
            let user = dbUser;

            if (user) {
                await knex('followed_players')
                    .where({ user_id: user.id, riot_id: rawInput.trim() })
                    .del();
            }

            await interaction.editReply({ 
                content: `${t.unfollowed_success} **${rawInput.trim()}**.` 
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Error removing player.' });
        }
    }

    // 7. /aide
    else if (commandName === 'aide') {
        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: `RadianiteDB • Help & Commands`, 
                iconURL: LOGO_ICON_URL 
            })
            .setTitle('Bot Overview & Quick Start')
            .setColor(0x00F5D4)
            .setDescription(`**RadianiteBot** automatically tracks matches, displays live rank progression with dynamic RR wheel graphics, and sends match reports to your Discord server.\n\nWebsite: **[${YOUR_WEBSITE_URL}](${YOUR_WEBSITE_URL})**`)
            .addFields(
                { name: '📊 `/stats <Player#TAG>`', value: 'Inspect full statistics, K/D, winrate, and high-res dynamic rank wheel.' },
                { name: '🔔 `/suivre <Player#TAG>`', value: 'Add player to automatic live match tracking notifications.' },
                { name: '🔕 `/neplus-suivre <Player#TAG>`', value: 'Stop tracking a player.' },
                { name: '📋 `/suivis`', value: 'View all players currently in your tracking list.' },
                { name: '📺 `/setchannel [channel]`', value: 'Set the target text channel for match alerts.' },
                { name: '🌐 `/language <en|fr>`', value: 'Set your preferred bot language (English / Français).' }
            )
            .setFooter({ text: t.footer, iconURL: LOGO_ICON_URL })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(t.open_site)
                .setStyle(ButtonStyle.Link)
                .setURL(YOUR_WEBSITE_URL)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
});

// --- Moteur de Surveillance des Matchs Suivis ---
async function checkFollowedPlayers() {
    try {
        const followedList = await knex('followed_players')
            .join('users', 'users.id', 'followed_players.user_id')
            .whereNotNull('users.discord_channel_id')
            .select(
                'followed_players.riot_id', 
                'users.discord_channel_id', 
                'users.discord_id', 
                'users.notify_mentions', 
                'users.notify_rankup_only', 
                'users.show_rank_wheel',
                'users.language'
            );

        if (!followedList || followedList.length === 0) return;

        // Regrouper par joueur
        const playersMap = {};
        for (const item of followedList) {
            if (!playersMap[item.riot_id]) {
                playersMap[item.riot_id] = [];
            }
            playersMap[item.riot_id].push({
                channel: item.discord_channel_id,
                user: item.discord_id,
                notify_mentions: item.notify_mentions !== false,
                notify_rankup_only: !!item.notify_rankup_only,
                show_rank_wheel: item.show_rank_wheel !== false,
                language: item.language || 'en'
            });
        }

        for (const [riotId, targets] of Object.entries(playersMap)) {
            if (!riotId.includes('#')) continue;
            const [name, tag] = riotId.split('#');

            try {
                // 1. Récupérer le dernier match via Henrik API
                const matchRes = await henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=1`);
                
                if (matchRes.data && matchRes.data.data && matchRes.data.data.length > 0) {
                    const latestMatch = matchRes.data.data[0];
                    const latestMatchId = latestMatch.metadata?.matchid;

                    if (!latestMatchId) continue;

                    // 2. Vérifier si ce match a déjà été notifié
                    const memory = await knex('bot_memory').where({ riot_id: riotId }).first();

                    if (memory && memory.last_match_id === latestMatchId) {
                        continue; // Déjà traité
                    }

                    // 3. Parser les statistiques du match
                    const playerObj = latestMatch.players?.all_players?.find(
                        p => p.name?.toLowerCase() === name.toLowerCase() && p.tag?.toLowerCase() === tag.toLowerCase()
                    );

                    if (!playerObj) continue;

                    const agentName = playerObj.character || 'Agent';
                    const agentKey = agentName.toLowerCase();
                    const agentIcon = AGENT_ASSETS[agentKey] || playerObj.assets?.agent?.small || null;
                    const mapName = latestMatch.metadata?.map || 'Map';
                    const mapSplash = MAP_SPLASHES[mapName.toLowerCase()] || null;

                    const stats = playerObj.stats || {};
                    const kills = stats.kills || 0;
                    const deaths = stats.deaths || 0;
                    const assists = stats.assists || 0;
                    const kd = (deaths > 0 ? (kills / deaths) : kills).toFixed(2);
                    const roundsPlayed = latestMatch.metadata?.rounds_played || 1;
                    const acs = Math.round((stats.score || 0) / roundsPlayed);
                    const adr = Math.round((playerObj.damage_made || 0) / roundsPlayed);
                    
                    const headshots = stats.headshots || 0;
                    const totalShots = headshots + (stats.bodyshots || 0) + (stats.legshots || 0);
                    const hsPercent = totalShots > 0 ? Math.round((headshots / totalShots) * 100) : 0;

                    const playerTeam = playerObj.team?.toLowerCase();
                    const teamData = latestMatch.teams?.[playerTeam] || { rounds_won: 0, rounds_lost: 0, has_won: false };
                    const isWin = teamData.has_won;

                    // Récupérer le changement de RR si disponible
                    let rrChangeStr = null;
                    let rrChangeNum = 0;
                    let currentRRNum = 50;
                    let currentTierNum = playerObj.currenttier || 18;
                    let currentRankStr = playerObj.currenttier_patched || 'Ranked';
                    let isRankup = false;

                    try {
                        const localStats = await localApi.get(`/api/stats/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
                        if (localStats.data?.rankInfo) {
                            currentRankStr = localStats.data.rankInfo.rankName || currentRankStr;
                            currentTierNum = localStats.data.rankInfo.tier || currentTierNum;
                            currentRRNum = localStats.data.rankInfo.rr || 0;
                            const ch = localStats.data.rankInfo.lastRRChange;
                            if (ch !== null && ch !== undefined && ch !== 0) {
                                rrChangeNum = ch;
                                rrChangeStr = ch > 0 ? `+${ch} RR` : `${ch} RR`;
                                if (ch > 0 && currentRRNum < ch) {
                                    isRankup = true;
                                }
                            }
                        }
                    } catch (e) {}

                    // Large Rank Wheel URL
                    const rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?tier=${currentTierNum}&rr=${currentRRNum}&change=${rrChangeNum}&rankup=${isRankup ? 1 : 0}&size=360&v=3&t=${Date.now()}`;

                    // Envoyer aux salons des utilisateurs selon leurs préférences
                    for (const target of targets) {
                        try {
                            if (target.notify_rankup_only && !isRankup) {
                                continue; 
                            }

                            const tLang = getT(target.language || 'en');
                            const channel = await client.channels.fetch(target.channel);
                            if (!channel) continue;

                            const embedColor = isRankup ? 0xFFE853 : (isWin ? 0x00F5D4 : 0xFF4655);
                            let resultTitle = isWin 
                                ? `${tLang.victory} // ${teamData.rounds_won} - ${teamData.rounds_lost}` 
                                : `${tLang.defeat} // ${teamData.rounds_won} - ${teamData.rounds_lost}`;

                            if (isRankup) {
                                resultTitle = `${tLang.rank_up_title} ${currentRankStr.toUpperCase()}`;
                            }

                            const embed = new EmbedBuilder()
                                .setAuthor({ 
                                    name: `RadianiteDB • ${tLang.match_report}`, 
                                    iconURL: LOGO_ICON_URL
                                })
                                .setTitle(`${resultTitle} • ${mapName.toUpperCase()}`)
                                .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(riotId)}`)
                                .setColor(embedColor)
                                .setDescription(isRankup 
                                    ? `> 👑 **${tLang.rank_up_banner} ${currentRankStr} (${currentRRNum} RR)**`
                                    : `> ⚔️ **${latestMatch.metadata?.mode || 'Competitive'}** • Score: **${teamData.rounds_won} - ${teamData.rounds_lost}**`
                                )
                                .setThumbnail(agentIcon || LOGO_ICON_URL)
                                .addFields(
                                    { name: tLang.played_agent, value: `**${agentName}**`, inline: true },
                                    { name: tLang.kda, value: `**${kills} / ${deaths} / ${assists}**\n(${kd} K/D)`, inline: true },
                                    { name: tLang.acs_adr, value: `**${acs} ACS**\n(${adr} ADR)`, inline: true },
                                    { name: tLang.precision, value: `**${hsPercent}% HS**\n(${headshots} heads)`, inline: true },
                                    { name: tLang.current_rank, value: `**${currentRankStr}**\n(${currentRRNum} RR)`, inline: true },
                                    { name: tLang.mmr_change, value: rrChangeStr ? `**${isRankup ? '★ ' : ''}${rrChangeStr}**` : `*${tLang.updated}*`, inline: true }
                                );

                            const finalImage = (target.show_rank_wheel !== false && rankWheelUrl) ? rankWheelUrl : mapSplash;
                            if (finalImage) {
                                embed.setImage(finalImage);
                            }

                            embed.setFooter({ text: tLang.footer, iconURL: LOGO_ICON_URL })
                                 .setTimestamp(new Date((latestMatch.metadata?.game_start || Date.now() / 1000) * 1000));

                            const actionRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setLabel(tLang.view_full)
                                    .setStyle(ButtonStyle.Link)
                                    .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(riotId)}`)
                            );

                            const mentionStr = target.notify_mentions ? `<@${target.user}>, ` : '';
                            const notificationText = isRankup 
                                ? `🎉 ${mentionStr}**${riotId}** ${tLang.rank_up_msg} **${currentRankStr}** !`
                                : `🔔 ${mentionStr}**${riotId}** ${tLang.match_ended} **${mapName}** !`;

                            await channel.send({ 
                                content: notificationText, 
                                embeds: [embed],
                                components: [actionRow]
                            });
                        } catch (err) {
                            console.error(`[RadianiteBot] Erreur envoi vers salon ${target.channel}:`, err);
                        }
                    }

                    // Enregistrer en mémoire
                    if (memory) {
                        await knex('bot_memory').where({ riot_id: riotId }).update({ last_match_id: latestMatchId });
                    } else {
                        await knex('bot_memory').insert({ riot_id: riotId, last_match_id: latestMatchId });
                    }
                }
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    console.warn('[RadianiteBot] Rate limit atteinte, mise en pause 60s...');
                    await sleep(60000);
                } else {
                    console.error(`[RadianiteBot] Erreur analyse pour ${riotId}:`, err.message);
                }
            }
        }
    } catch (error) {
        console.error('[RadianiteBot] Erreur générale lors de la vérification :', error);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Lancement du Bot
if (BOT_TOKEN) {
    client.login(BOT_TOKEN).catch(err => {
        console.error('[RadianiteBot] Erreur critique de connexion Discord :', err.message);
    });
} else {
    console.warn('[RadianiteBot] DISCORD_BOT_TOKEN manquant dans le fichier .env.');
}
