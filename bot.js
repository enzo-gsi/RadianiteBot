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
    'neon': 'https://media.valorant-api.com/agents/bb2a4830-492d-a480-d4fb-61d36cca850d/displayicon.png',
    'fade': 'https://media.valorant-api.com/agents/dad69b49-4378-b19e-ee7e-043ec4ca5255/displayicon.png',
    'harbor': 'https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png',
    'gekko': 'https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png',
    'deadlock': 'https://media.valorant-api.com/agents/cc8b64c8-4b25-4ff9-6e7f-37b4da43d235/displayicon.png',
    'iso': 'https://media.valorant-api.com/agents/0e38b510-41a8-5780-5e8f-568b2a4f2d6c/displayicon.png',
    'clove': 'https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png',
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

// --- Définition des Commandes Slash V2 ---
const slashCommands = [
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Définit le salon où recevoir les notifications de fin de partie.')
        .addChannelOption(opt => 
            opt.setName('salon')
               .setDescription('Salon textuel cible (optionnel, par défaut ce salon)')
               .setRequired(false)
        ),
    
    new SlashCommandBuilder()
        .setName('suivis')
        .setDescription('Affiche la liste de tous les joueurs Valorant que vous suivez.'),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Affiche le dossier tactique et les statistiques d\'un joueur.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Identifiant Riot au format Pseudo#TAG (ex: TenZ#SEN)')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('suivre')
        .setDescription('Ajoute un joueur à votre liste de surveillance automatique.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Identifiant Riot au format Pseudo#TAG (ex: TenZ#SEN)')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('neplus-suivre')
        .setDescription('Retire un joueur de votre liste de surveillance.')
        .addStringOption(opt =>
            opt.setName('joueur')
               .setDescription('Identifiant Riot au format Pseudo#TAG à retirer')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('aide')
        .setDescription('Affiche le guide complet et les commandes du bot RadianiteDB.')
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
        console.log('[RadianiteBot] 6 Commandes Slash enregistrées avec succès.');
    } catch (error) {
        console.error('[RadianiteBot] Erreur enregistrement commandes:', error);
    }
});

// --- Gestion des Interactions Slash Commands ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const discord_id = interaction.user.id;

    // Helper: récupérer l'utilisateur dans Supabase
    async function getDbUser() {
        return await knex('users').where({ discord_id: String(discord_id) }).first();
    }

    // 1. /setchannel
    if (commandName === 'setchannel') {
        const targetChannel = interaction.options.getChannel('salon') || interaction.channel;

        try {
            let user = await getDbUser();
            if (!user) {
                const connectButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Se connecter sur RadianiteDB')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`${YOUR_WEBSITE_URL}/auth/discord`)
                );

                return await interaction.reply({ 
                    content: `⚠️ **Compte non lié** : Vous devez d'abord vous connecter avec Discord sur **[${YOUR_WEBSITE_URL}](${YOUR_WEBSITE_URL})** pour activer les notifications automatiques.`,
                    components: [connectButton],
                    ephemeral: true 
                });
            }

            await knex('users').where({ discord_id: String(discord_id) }).update({
                discord_channel_id: targetChannel.id
            });
            
            const embed = new EmbedBuilder()
                .setTitle('🎯 SALON DE TRANSMISSION CONFIGURÉ')
                .setColor(0x00F5D4)
                .setDescription(`Les alertes de fin de match pour vos joueurs suivis seront désormais envoyées dans <#${targetChannel.id}> !`)
                .setFooter({ text: 'RadianiteDB Notification Engine • Supabase PostgreSQL' });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: '❌ Une erreur est survenue lors de la configuration du salon.', ephemeral: true });
        }
    }

    // 2. /suivis
    else if (commandName === 'suivis') {
        try {
            await interaction.deferReply({ ephemeral: true });
            const user = await getDbUser();

            if (!user) {
                return await interaction.editReply({ 
                    content: `⚠️ Vous n'avez pas encore de compte lié sur **[${YOUR_WEBSITE_URL}](${YOUR_WEBSITE_URL})**.` 
                });
            }

            const followed = await knex('followed_players').where({ user_id: user.id }).select();

            if (!followed || followed.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('📋 JOUEURS SUIVIS // AUCUN JOUEUR')
                    .setColor(0xFF4655)
                    .setDescription(`Vous ne suivez aucun joueur pour le moment.\n\n👉 Utilisez la commande \`/suivre [Pseudo#TAG]\` ou cliquez sur **Follow** sur le site pour recevoir des notifications en direct !`)
                    .setFooter({ text: 'RadianiteDB Tracking Hub' });

                return await interaction.editReply({ embeds: [embed] });
            }

            const channelMention = user.discord_channel_id ? `<#${user.discord_channel_id}>` : '*Non configuré (utilisez `/setchannel`)*';
            const listFormatted = followed.map((f, i) => `**${i + 1}.** \`${f.riot_id}\` • [Voir le profil](${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(f.riot_id)})`).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📋 VOS JOUEURS SUIVIS (${followed.length})`)
                .setColor(0x00F5D4)
                .setDescription(listFormatted)
                .addFields(
                    { name: '📡 Salon de notification actuel', value: channelMention, inline: false }
                )
                .setFooter({ text: 'RadianiteDB Tracking Hub • Notifications automatiques toutes les 5 min' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Ouvrir RadianiteDB')
                    .setStyle(ButtonStyle.Link)
                    .setURL(YOUR_WEBSITE_URL)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Erreur lors de la récupération des joueurs suivis.' });
        }
    }

    // 3. /stats
    else if (commandName === 'stats') {
        const rawInput = interaction.options.getString('joueur');
        if (!rawInput.includes('#')) {
            return await interaction.reply({ content: '❌ Format invalide. Veuillez préciser le Tag Riot (ex: `TenZ#SEN`).', ephemeral: true });
        }

        const [name, tag] = rawInput.trim().split('#');

        try {
            await interaction.deferReply();

            const statsRes = await localApi.get(`/api/stats/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
            const data = statsRes.data;

            const pInfo = data.playerInfo || {};
            const rInfo = data.rankInfo || {};
            const overview = data.overviewStats || {};

            const rankName = rInfo.rankName || 'Unranked';
            const rr = rInfo.rr || 0;
            const kd = overview.kd || '0.00';
            const winRate = overview.winRate || 0;
            const acs = overview.acs || '0';
            const adr = overview.adr || '0';
            const hs = overview.hsPercent || '0';
            const score = overview.statsScore || 0;

            const bestAgent = overview.bestAgent || data.analysis?.agents?.best?.name || 'Agent';
            const agentKey = bestAgent.toLowerCase();
            const tierNum = (rInfo.tier !== undefined && rInfo.tier !== null) ? rInfo.tier : 18;
            const rrNum = rInfo.rr || 0;
            const lastChangeNum = rInfo.lastRRChange || 0;
            const rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?tier=${tierNum}&rr=${rrNum}&change=${lastChangeNum}&size=360`;

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: `RADIANITEDB // DOSSIER JOUEUR TACTIQUE`,
                    iconURL: 'https://cdn.discordapp.com/emojis/849999088656678912.png'
                })
                .setTitle(`${pInfo.name || rawInput} • LVL ${pInfo.level || 1}`)
                .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(rawInput)}`)
                .setColor(score >= 600 ? 0x00F5D4 : 0xFF4655)
                .setThumbnail(rankWheelUrl)
                .setDescription(`Région: **${pInfo.region || 'EU'}** • Score Combat: **${score} / 1000** ⚡\n> *Données officielles synchronisées avec Supabase Cloud*`)
                .addFields(
                    { name: '◈ Rang Actuel', value: `**${rankName}**\n(${rr} RR)`, inline: true },
                    { name: '◈ Combat K/D', value: `**${kd} K/D**\n(${overview.gameCount || 0} matchs)`, inline: true },
                    { name: '◈ Taux de Victoire', value: `**${winRate}% Winrate**\n(${Math.round((winRate/100) * (overview.gameCount || 0))} V)`, inline: true },
                    { name: '◈ ACS / ADR', value: `**${acs} ACS**\n(${adr} ADR)`, inline: true },
                    { name: '◈ Précision Tirs', value: `**${hs}% Headshot**\nTirs tête`, inline: true },
                    { name: '◈ Spécialité Agent', value: `**${bestAgent}**\nAgent dominant`, inline: true }
                )
                .setFooter({ text: 'RadianiteDB Live Analytics • Données officielles Valorant' })
                .setTimestamp();

            if (pInfo.bestAgentSplash || pInfo.bestMapSplash) {
                embed.setImage(pInfo.bestAgentSplash || pInfo.bestMapSplash);
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Voir les 100+ Matchs & Stats complètes')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(rawInput)}`),
                new ButtonBuilder()
                    .setLabel('Ouvrir RadianiteDB')
                    .setStyle(ButtonStyle.Link)
                    .setURL(YOUR_WEBSITE_URL)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: `❌ Impossible de récupérer les statistiques pour **${rawInput}**. Vérifiez l'orthographe du pseudo et du tag.` });
        }
    }

    // 4. /suivre
    else if (commandName === 'suivre') {
        const rawInput = interaction.options.getString('joueur');
        if (!rawInput.includes('#')) {
            return await interaction.reply({ content: '❌ Format invalide. Exemple: `/suivre TenZ#SEN`', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });
            let user = await getDbUser();

            if (!user) {
                const [inserted] = await knex('users').insert({
                    discord_id: String(discord_id),
                    username: interaction.user.tag,
                    avatar: interaction.user.displayAvatarURL()
                });
                user = await getDbUser();
            }

            const cleanId = rawInput.trim();
            const existing = await knex('followed_players').where({
                user_id: user.id,
                riot_id: cleanId
            }).first();

            if (existing) {
                return await interaction.editReply({ content: `ℹ️ Vous suivez déjà **${cleanId}**.` });
            }

            await knex('followed_players').insert({
                user_id: user.id,
                riot_id: cleanId
            });

            const embed = new EmbedBuilder()
                .setTitle('✅ JOUEUR AJOUTÉ À LA SURVEILLANCE')
                .setColor(0x00F5D4)
                .setDescription(`Vous suivez désormais **${cleanId}** !\nDès qu'une nouvelle partie compétitive se termine, vous recevrez une alerte complète ici.`)
                .setFooter({ text: 'RadianiteDB Notification Engine' });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Erreur lors de l\'ajout du joueur.' });
        }
    }

    // 5. /neplus-suivre
    else if (commandName === 'neplus-suivre') {
        const rawInput = interaction.options.getString('joueur').trim();

        try {
            await interaction.deferReply({ ephemeral: true });
            const user = await getDbUser();
            if (!user) {
                return await interaction.editReply({ content: '⚠️ Aucun compte lié trouvé.' });
            }

            const deleted = await knex('followed_players').where({
                user_id: user.id,
                riot_id: rawInput
            }).del();

            if (deleted > 0) {
                await interaction.editReply({ content: `✅ Vous ne suivez plus **${rawInput}**.` });
            } else {
                await interaction.editReply({ content: `ℹ️ Vous ne suiviez pas **${rawInput}**.` });
            }
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ Erreur lors de la suppression.' });
        }
    }

    // 6. /aide
    else if (commandName === 'aide') {
        const embed = new EmbedBuilder()
            .setTitle('📖 RADIANITEDB // GUIDE DU BOT & COMMANDES')
            .setColor(0x00F5D4)
            .setDescription(`**RadianiteBot** surveille en direct les parties Valorant de vos joueurs favoris et vous alerte dès qu'un match se termine !`)
            .addFields(
                { name: '`/setchannel [salon]`', value: 'Définit le salon Discord où recevoir les alertes de fin de partie.' },
                { name: '`/suivre [Pseudo#TAG]`', value: 'Ajoute un joueur Valorant à votre liste de surveillance.' },
                { name: '`/neplus-suivre [Pseudo#TAG]`', value: 'Retire un joueur de vos notifications.' },
                { name: '`/suivis`', value: 'Affiche tous les joueurs que vous suivez actuellement.' },
                { name: '`/stats [Pseudo#TAG]`', value: 'Affiche instantanément la fiche de stats, K/D, rang et MMR d\'un joueur.' },
                { name: '🌐 Site Web', value: `Consultez l'historique infini et comparez vos duels sur **[${YOUR_WEBSITE_URL}](${YOUR_WEBSITE_URL})**.` }
            )
            .setFooter({ text: 'RadianiteDB • Powered by Supabase PostgreSQL' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Accéder au site RadianiteDB')
                .setStyle(ButtonStyle.Link)
                .setURL(YOUR_WEBSITE_URL)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
});

// --- MOTEUR DE SURVEILLANCE AUTOMATIQUE DES MATCHS ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function checkFollowedPlayers() {
    console.log('[RadianiteBot] Analyse des nouveaux matchs en cours...');
    
    try {
        const subscriptions = await knex('followed_players')
            .join('users', 'users.id', 'followed_players.user_id')
            .whereNotNull('users.discord_channel_id')
            .select('followed_players.riot_id', 'users.discord_channel_id', 'users.discord_id');

        if (subscriptions.length === 0) {
            return;
        }

        // Regrouper par joueur
        const playersToWatch = new Map();
        for (const sub of subscriptions) {
            if (!playersToWatch.has(sub.riot_id)) {
                playersToWatch.set(sub.riot_id, []);
            }
            playersToWatch.get(sub.riot_id).push({ 
                channel: sub.discord_channel_id, 
                user: sub.discord_id 
            });
        }

        // Vérifier chaque joueur
        for (const [riotId, targets] of playersToWatch.entries()) {
            try {
                const [name, tag] = riotId.split('#');
                if (!name || !tag) continue;

                // Récupérer le match le plus récent
                const matchRes = await henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=3`);
                const matches = matchRes.data?.data || [];
                if (matches.length === 0) continue;
                
                const latestMatch = matches[0];
                const latestMatchId = latestMatch.metadata?.matchid;
                if (!latestMatchId) continue;

                const memory = await knex('bot_memory').where({ riot_id: riotId }).first();
                const lastAnnouncedId = memory ? memory.last_match_id : null;

                if (latestMatchId !== lastAnnouncedId) {
                    console.log(`[RadianiteBot] 🚨 Nouveau match détecté pour ${riotId}: ${latestMatchId}`);
                    
                    const playerObj = latestMatch.players?.all_players?.find(p => p.name.toLowerCase() === name.toLowerCase());
                    if (!playerObj || !playerObj.stats) continue;

                    const playerTeam = (playerObj.team || 'red').toLowerCase();
                    const teamData = latestMatch.teams?.[playerTeam] || { has_won: false, rounds_won: 0, rounds_lost: 0 };
                    const isWin = teamData.has_won;

                    const kills = playerObj.stats.kills || 0;
                    const deaths = playerObj.stats.deaths || 0;
                    const assists = playerObj.stats.assists || 0;
                    const deathsForKd = deaths > 0 ? deaths : 1;
                    const kd = (kills / deathsForKd).toFixed(2);
                    const roundsPlayed = latestMatch.metadata?.rounds_played || (teamData.rounds_won + teamData.rounds_lost) || 1;
                    const acs = Math.round((playerObj.stats.score || 0) / roundsPlayed);
                    const damageMade = playerObj.damage_made || 0;
                    const adr = Math.round(damageMade / roundsPlayed);
                    
                    const headshots = playerObj.stats.headshots || 0;
                    const totalShots = (playerObj.stats.headshots || 0) + (playerObj.stats.bodyshots || 0) + (playerObj.stats.legshots || 0);
                    const hsPercent = totalShots > 0 ? Math.round((headshots / totalShots) * 100) : 0;

                    const agentName = playerObj.character || 'Agent';
                    const agentKey = agentName.toLowerCase();
                    const agentIcon = AGENT_ASSETS[agentKey] || playerObj.assets?.agent?.small || 'https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png';

                    const mapName = latestMatch.metadata?.map || 'Ascent';
                    const mapKey = mapName.toLowerCase();
                    const mapSplash = MAP_SPLASHES[mapKey] || null;

                    // Récupérer le changement de RR si disponible
                    let rrChangeStr = null;
                    let rrChangeNum = 0;
                    let currentRRNum = 50;
                    let currentTierNum = playerObj.currenttier || 18;
                    let currentRankStr = playerObj.currenttier_patched || 'Classé';
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
                                // Detection de promotion (Rankup)
                                if (ch > 0 && currentRRNum < ch) {
                                    isRankup = true;
                                }
                            }
                        }
                    } catch (e) {}

                    // Construction de la Roue de Rang Dynamique (Gain Vert / Perte Rouge / Rankup Or)
                    const rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?tier=${currentTierNum}&rr=${currentRRNum}&change=${rrChangeNum}&rankup=${isRankup ? 1 : 0}&size=360`;

                    // Construction du somptueux Embed tactique
                    const embedColor = isRankup ? 0xFFE853 : (isWin ? 0x00F5D4 : 0xFF4655);
                    let resultTitle = isWin 
                        ? `VICTOIRE // ${teamData.rounds_won} - ${teamData.rounds_lost}` 
                        : `DÉFAITE // ${teamData.rounds_won} - ${teamData.rounds_lost}`;

                    if (isRankup) {
                        resultTitle = `★ RANK UP // PROMOTION EN ${currentRankStr.toUpperCase()}`;
                    }

                    const embed = new EmbedBuilder()
                        .setAuthor({ 
                            name: `RADIANITEDB // RAPPORT DE MATCH EN DIRECT`, 
                            iconURL: 'https://cdn.discordapp.com/emojis/849999088656678912.png'
                        })
                        .setTitle(`${resultTitle} • ${mapName.toUpperCase()}`)
                        .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(riotId)}`)
                        .setColor(embedColor)
                        .setDescription(`Dossier tactique de fin de partie pour **${riotId}** (${(latestMatch.metadata?.mode || 'Competitive').toUpperCase()})\n${isRankup ? `> 👑 **Félicitations ! Le joueur est monté ${currentRankStr} (${currentRRNum} RR)**` : ''}`)
                        .setThumbnail(rankWheelUrl)
                        .addFields(
                            { name: '◈ Agent Joué', value: `**${agentName}**`, inline: true },
                            { name: '◈ Combat K / D / A', value: `**${kills} / ${deaths} / ${assists}**\n(${kd} K/D)`, inline: true },
                            { name: '◈ Score (ACS / ADR)', value: `**${acs} ACS**\n(${adr} ADR)`, inline: true },
                            { name: '◈ Précision Tirs', value: `**${hsPercent}% Headshot**\n(${headshots} têtes)`, inline: true },
                            { name: '◈ Rang Actuel', value: `**${currentRankStr}**\n(${currentRRNum} RR)`, inline: true },
                            { name: '◈ Évolution MMR', value: rrChangeStr ? `**${isRankup ? '★ ' : ''}${rrChangeStr}**` : `*Mis à jour*`, inline: true }
                        )
                        .setFooter({ text: `RadianiteDB Auto-Tracking • Supabase Cloud PostgreSQL` })
                        .setTimestamp(new Date((latestMatch.metadata?.game_start || Date.now() / 1000) * 1000));

                    if (mapSplash) {
                        embed.setImage(mapSplash);
                    }

                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Consulter le dossier complet sur RadianiteDB')
                            .setStyle(ButtonStyle.Link)
                            .setURL(`${YOUR_WEBSITE_URL}/?search=${encodeURIComponent(riotId)}`)
                    );

                    // Envoyer aux salons des utilisateurs
                    for (const target of targets) {
                        try {
                            const channel = await client.channels.fetch(target.channel);
                            if (channel) {
                                const notificationText = isRankup 
                                    ? `🎉 <@${target.user}>, **${riotId}** vient de **RANK UP** en **${currentRankStr}** !`
                                    : `🔔 <@${target.user}>, **${riotId}** a terminé sa partie sur **${mapName}** !`;

                                await channel.send({ 
                                    content: notificationText, 
                                    embeds: [embed],
                                    components: [actionRow]
                                });
                            }
                        } catch (err) {
                            console.error(`[RadianiteBot] Erreur envoi vers salon ${target.channel}:`, err.message);
                        }
                    }

                    // Enregistrer en mémoire Supabase
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
            
            await sleep(4000);
        }
    } catch (globalErr) {
        console.error("[RadianiteBot] Erreur globale de surveillance:", globalErr.message);
    }
}

// Planification automatique toutes les 5 minutes
cron.schedule('*/5 * * * *', checkFollowedPlayers);

if (!BOT_TOKEN) {
    console.error("ERREUR CRITIQUE: DISCORD_BOT_TOKEN est manquant dans votre fichier .env !");
} else {
    client.login(BOT_TOKEN).catch(err => {
        console.error("Erreur de connexion du bot Discord:", err.message);
    });
}
