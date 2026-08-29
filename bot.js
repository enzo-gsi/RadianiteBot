require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    EmbedBuilder, 
    ApplicationCommandOptionType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const cron = require('node-cron');
const { knex } = require('./database.js'); 
const axios = require('axios'); 
const {
    encryptData,
    decryptData,
    loginRiotRSO,
    submit2FACode,
    buildSessionPayload,
    fetchStorefront,
    extractTokensFromUri
} = require('./riotAuth.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1436123733197590624';
const HENRIK_API_KEY = process.env.HENRIK_API_KEY;
const YOUR_WEBSITE_URL = process.env.WEBSITE_URL || "https://www.radianitedb.lol";

const henrikApi = axios.create({
    baseURL: 'https://api.henrikdev.xyz',
    headers: { 'Authorization': HENRIK_API_KEY }
});

const localApi = axios.create({
    baseURL: YOUR_WEBSITE_URL
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Cache for Valorant skins & client version
let valorantWeaponMap = {};
let valorantSkinLevelMap = {};
let valorantBundleMap = {};
let cachedRiotVersion = 'release-13.04-shipping-18-5304478';

// Temporary in-memory storage for pending 2FA challenges (expires in 10 minutes)
const pending2FAMap = new Map(); // discord_id -> { cookies, expiresAt }

async function refreshValorantData() {
    try {
        const [vRes, wRes, bRes] = await Promise.all([
            axios.get('https://valorant-api.com/v1/version').catch(() => null),
            axios.get('https://valorant-api.com/v1/weapons').catch(() => null),
            axios.get('https://valorant-api.com/v1/bundles').catch(() => null)
        ]);

        if (vRes?.data?.data?.riotClientVersion) {
            cachedRiotVersion = vRes.data.data.riotClientVersion;
        }

        if (wRes?.data?.data) {
            wRes.data.data.forEach(weapon => {
                weapon.skins.forEach(skin => {
                    valorantWeaponMap[skin.uuid] = skin;
                    skin.levels.forEach(lvl => {
                        valorantSkinLevelMap[lvl.uuid] = {
                            ...skin,
                            displayName: skin.displayName,
                            levelName: lvl.displayName,
                            displayIcon: lvl.displayIcon || skin.displayIcon
                        };
                    });
                });
            });
        }

        if (bRes?.data?.data) {
            bRes.data.data.forEach(bundle => {
                valorantBundleMap[bundle.uuid] = bundle;
            });
        }
    } catch (err) {
        console.warn("[RadianiteBot] Warning loading Valorant metadata:", err.message);
    }
}

// Slash Commands Definition (All descriptions <= 100 chars as per Discord API)
const commands = [
    {
        name: 'boutique',
        description: 'Boutique Valorant du jour, soldes VP/RP/KC et Marché Nocturne.',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez votre lien officiel Riot ou jeton',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'store',
        description: 'Boutique Valorant du jour en direct (alias /boutique).',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez votre lien officiel Riot ou jeton',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'shop',
        description: 'Boutique Valorant du jour en direct (alias /boutique).',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez votre lien officiel Riot ou jeton',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'login',
        description: 'Lier votre compte Riot (session persistante chiffrée AES-256).',
        options: [
            {
                name: 'identifiant',
                description: 'Option 1: Nom d\'utilisateur Riot Games (login launcher)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'mot_de_passe',
                description: 'Option 1: Mot de passe Riot Games',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'lien',
                description: 'Option 2: Lien officiel Riot (playvalorant.com/opt_in...)',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: '2fa',
        description: 'Valider le code de sécurité 2FA reçu par email.',
        options: [
            {
                name: 'code',
                description: 'Le code de sécurité à 6 chiffres reçu par email',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'unlink',
        description: 'Supprimer définitivement votre session Riot du bot.',
    },
    {
        name: 'setchannel',
        description: 'Définir ce salon textuel pour les alertes de fin de match.',
    },
    {
        name: 'wishlist',
        description: 'Gérer vos skins souhaités (alertes MP automatiques lors des rotations de boutique).',
        options: [
            {
                name: 'ajouter',
                description: 'Ajouter un skin à surveiller dans votre boutique quotidienne.',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'skin',
                        description: 'Nom du skin d\'arme Valorant à surveiller',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            {
                name: 'retirer',
                description: 'Retirer un skin de votre liste de surveillance.',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'skin',
                        description: 'Nom du skin à retirer de votre liste',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            {
                name: 'liste',
                description: 'Afficher tous vos skins actuellement surveillés.',
                type: ApplicationCommandOptionType.Subcommand
            }
        ]
    },
    {
        name: 'scout',
        description: 'Analyser en direct le lobby et les rangs/stats des adversaires.',
        options: [
            {
                name: 'joueur',
                description: 'Optionnel: Pseudo#TAG du joueur à analyser',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'classement',
        description: 'Classement compétitif du serveur Discord (Top RR, Rangs, K/D).',
    },
    {
        name: 'leaderboard',
        description: 'Server competitive leaderboard (Top RR, Ranks, K/D).',
    },
    {
        name: 'session',
        description: 'Rapport de performance des parties jouées sur les dernières 24h.',
        options: [
            {
                name: 'joueur',
                description: 'Optionnel: Pseudo#TAG du joueur à analyser',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'language',
        description: 'Choisir la langue des messages du bot (Français / English).',
        options: [
            {
                name: 'langue',
                description: 'Sélectionnez Français ou English',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: '🇫🇷 Français', value: 'fr' },
                    { name: '🇺🇸 English', value: 'en' }
                ]
            }
        ]
    },
    {
        name: 'langue',
        description: 'Choisir la langue des messages du bot (Français / English).',
        options: [
            {
                name: 'langue',
                description: 'Sélectionnez Français ou English',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: '🇫🇷 Français', value: 'fr' },
                    { name: '🇺🇸 English', value: 'en' }
                ]
            }
        ]
    }
];

// Register Slash Commands (Global Only - Cleans up Guild duplicates)
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function registerSlashCommands() {
    try {
        console.log('[RadianiteBot] Enregistrement des commandes Slash globales...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log('[RadianiteBot] ✅ Commandes globales enregistrées.');

        // Nettoyage des anciennes commandes locales de serveur pour éviter les doublons dans l'UI Discord
        const guilds = await client.guilds.fetch();
        for (const [guildId] of guilds) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, guildId),
                    { body: [] }
                );
            } catch (gErr) {}
        }
        console.log('[RadianiteBot] 🧹 Nettoyage des doublons de serveurs terminé.');
    } catch (error) {
        console.error('[RadianiteBot] Erreur enregistrement commandes:', error);
    }
}

client.once('ready', async () => {
    console.log(`[RadianiteBot] Connecté en tant que ${client.user.tag} !`);
    await refreshValorantData();
    await registerSlashCommands();
});

// Auto-register on new guild join & Notify Owner @codedwld in DM
client.on('guildCreate', async guild => {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id),
            { body: commands }
        );
    } catch (e) {}

    // Send DM Notification to @codedwld
    try {
        const ownerId = process.env.OWNER_DISCORD_ID || 'codedwld';
        let targetUser = null;
        
        // Try direct ID fetch first
        if (/^\d+$/.test(ownerId)) {
            targetUser = await client.users.fetch(ownerId).catch(() => null);
        }
        
        // If not found by ID or ID is username, find across cache/guilds
        if (!targetUser) {
            targetUser = client.users.cache.find(u => 
                u.username.toLowerCase() === 'codedwld' || 
                u.tag?.toLowerCase() === 'codedwld' || 
                u.globalName?.toLowerCase() === 'codedwld'
            );
        }

        if (!targetUser) {
            // Search in guild members
            for (const [, g] of client.guilds.cache) {
                try {
                    const members = await g.members.fetch({ query: 'codedwld', limit: 5 });
                    const found = members.find(m => 
                        m.user.username.toLowerCase() === 'codedwld' || 
                        m.user.tag?.toLowerCase() === 'codedwld' ||
                        m.user.globalName?.toLowerCase() === 'codedwld'
                    );
                    if (found) {
                        targetUser = found.user;
                        break;
                    }
                } catch (mErr) {}
            }
        }

        if (targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('🎉 Nouveau serveur ajouté !')
                .setColor(0x00f5d4)
                .setDescription(`Le bot **RadianiteDB** vient d'être ajouté sur un nouveau serveur Discord !`)
                .addFields(
                    { name: '🏷️ Nom du serveur', value: `**${guild.name}**`, inline: true },
                    { name: '🆔 ID du serveur', value: `\`${guild.id}\``, inline: true },
                    { name: '👥 Membres', value: `${guild.memberCount || 'Inconnu'}`, inline: true },
                    { name: '👑 Propriétaire', value: `<@${guild.ownerId}> (\`${guild.ownerId}\`)`, inline: true },
                    { name: '📊 Total serveurs actuels', value: `**${client.guilds.cache.size} serveurs**`, inline: true }
                )
                .setThumbnail(guild.iconURL({ dynamic: true }) || 'https://www.radianitedb.lol/favicon.png')
                .setTimestamp();

            await targetUser.send({ embeds: [embed] }).catch(err => {
                console.warn('[GuildCreate] Impossible d\'envoyer le MP à @codedwld:', err.message);
            });
            console.log(`[GuildCreate] Notification MP envoyée à ${targetUser.tag} pour le serveur ${guild.name}`);
        } else {
            console.log(`[GuildCreate] Rejoint ${guild.name} (${guild.memberCount} membres). @codedwld non trouvé en cache (précisez OWNER_DISCORD_ID dans .env si besoin).`);
        }
    } catch (notifErr) {
        console.error('[GuildCreate] Erreur notification MP:', notifErr.message);
    }
});

const RIOT_AUTH_URL = "https://auth.riotgames.com/authorize?client_id=play-valorant-web-prod&response_type=token%20id_token&redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&scope=account%20openid&nonce=1";

function createLoginActionRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('1. Se connecter sur Riot Games')
            .setStyle(ButtonStyle.Link)
            .setURL(RIOT_AUTH_URL)
            .setEmoji('🔗'),
        new ButtonBuilder()
            .setCustomId('btn_paste_riot_link')
            .setLabel('2. Coller mon lien de connexion')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📋')
    );
}

// Helper: Handle Store Display Embed Generation
async function handleStoreInteraction(interaction, tokenArg) {
    await interaction.deferReply({ ephemeral: true });

    const isEn = (await getUserLang(interaction.user.id)) === 'en';
    let authSession = null;

    // 1. Direct token/link passed in command
    if (tokenArg) {
        const extracted = extractTokensFromUri(tokenArg);
        if (extracted.accessToken) {
            try {
                authSession = await buildSessionPayload(extracted.accessToken, extracted.idToken, {});
                const encryptedSession = encryptData(authSession);
                const existingUser = await knex('users').where({ discord_id: interaction.user.id }).first();
                if (existingUser) {
                    await knex('users').where({ discord_id: interaction.user.id }).update({ riot_auth: encryptedSession });
                } else {
                    await knex('users').insert({
                        discord_id: interaction.user.id,
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL(),
                        riot_auth: encryptedSession
                    });
                }
            } catch (err) {
                return interaction.editReply({
                    content: isEn 
                        ? `❌ **The provided Riot link or token is invalid or expired.**\nPlease reconnect using the buttons below.`
                        : `❌ **Le lien ou jeton Riot fourni est invalide ou a expiré.**\nVeuillez vous reconnecter via les boutons ci-dessous.`,
                    components: [createLoginActionRow()]
                });
            }
        }
    }

    // 2. Check Database for Saved Encrypted Session
    if (!authSession) {
        const user = await knex('users').where({ discord_id: interaction.user.id }).first();
        if (user && user.riot_auth) {
            authSession = decryptData(user.riot_auth);
        }
    }

    // 3. If still no session, provide interactive buttons
    if (!authSession) {
        const loginEmbed = new EmbedBuilder()
            .setTitle(isEn ? '🛒 VALORANT STORE • LOGIN REQUIRED' : '🛒 BOUTIQUE VALORANT • CONNEXION REQUISE')
            .setColor(0x00f5d4)
            .setDescription(
                isEn
                    ? `To view your live daily store, link your Riot account to the bot (persistent AES-256 encrypted session).\n\n` +
                      `**Quick & Easy Steps (1-Click) :**\n` +
                      `1️⃣ Click **"1. Sign in with Riot Games"** below.\n` +
                      `2️⃣ Sign in on the official Riot Games page.\n` +
                      `3️⃣ Copy the redirect URL (\`https://playvalorant.com/opt_in#access_token=...\`).\n` +
                      `4️⃣ Click **"2. Paste connection link"** to validate!`
                    : `Pour afficher votre boutique du jour en direct, liez votre compte Riot au bot (session persistante chiffrée AES-256).\n\n` +
                      `**Étapes simples (1-Clic) :**\n` +
                      `1️⃣ Cliquez sur **"1. Se connecter sur Riot Games"** ci-dessous.\n` +
                      `2️⃣ Connectez-vous sur la page officielle Riot Games.\n` +
                      `3️⃣ Copiez l'URL de redirection (\`https://playvalorant.com/opt_in#access_token=...\`).\n` +
                      `4️⃣ Cliquez sur **"2. Coller mon lien de connexion"** pour valider !`
            );
        return interaction.editReply({
            embeds: [loginEmbed],
            components: [createLoginActionRow()]
        });
    }

    // 4. Fetch Live Storefront via riotAuth
    try {
        const storeResult = await fetchStorefront(authSession, cachedRiotVersion);
        const storeData = storeResult.store;
        const balances = storeResult.wallet;

        // If session was silently refreshed, update encrypted session in DB
        if (storeResult.session && storeResult.session.accessToken !== authSession.accessToken) {
            const updatedEncrypted = encryptData(storeResult.session);
            await knex('users').where({ discord_id: interaction.user.id }).update({
                riot_auth: updatedEncrypted
            }).catch(() => {});
        }

        const username = authSession.username || 'Agent';
        const shard = (authSession.shard || 'eu').toUpperCase();

        const vp = (balances['85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741'] || 0).toLocaleString();
        const rad = (balances['e59aa87c-4cbf-517a-5983-6e81511be9b7'] || 0).toLocaleString();
        const kc = (balances['85ca954a-41f2-ce94-9b45-8ca3dd39a00d'] || 0).toLocaleString();

        const priceMap = {};
        if (storeData.SkinsPanelLayout?.SingleItemStoreOffers) {
            storeData.SkinsPanelLayout.SingleItemStoreOffers.forEach(o => {
                const vpPrice = o.Cost?.['85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741'] || o.Cost?.['85AD13F7-3D1B-5128-9EB2-7CD8EE0B5741'];
                if (vpPrice) priceMap[o.OfferID] = vpPrice;
            });
        }

        const offers = (storeData.SkinsPanelLayout?.SingleItemOffers || []).map(uuid => {
            const item = valorantSkinLevelMap[uuid] || valorantWeaponMap[uuid] || { displayName: isEn ? 'Weapon Skin' : 'Skin d\'arme' };
            const exactPrice = priceMap[uuid] || 1775;
            return { ...item, exactPrice };
        });

        const resetDuration = storeData.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 86400;
        const resetTimestamp = Math.floor(Date.now() / 1000) + resetDuration;

        const allEmbeds = [];

        // 1. Header Embed with Balances & Rotation Countdown
        const headerEmbed = new EmbedBuilder()
            .setTitle(isEn ? `🛒 DAILY STORE • ${username.toUpperCase()}` : `🛒 BOUTIQUE DU JOUR • ${username.toUpperCase()}`)
            .setColor(0x00f5d4)
            .setDescription(
                isEn
                    ? `💰 **Your Balances :** **${vp} VP** | **${rad} RP** | **${kc} KC**\n` +
                      `🌐 **Server :** ${shard} • ⏱️ **Rotation in :** <t:${resetTimestamp}:R>\n` +
                      `────────────────────────────────────────`
                    : `💰 **Vos Soldes :** **${vp} VP** | **${rad} RP** | **${kc} KC**\n` +
                      `🌐 **Serveur :** ${shard} • ⏱️ **Rotation dans :** <t:${resetTimestamp}:R>\n` +
                      `────────────────────────────────────────`
            )
            .setThumbnail('https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png')
            .setTimestamp();

        allEmbeds.push(headerEmbed);

        // 2. Individual Embed for each Skin with its actual image displayed
        offers.forEach((offer, idx) => {
            const skinEmbed = new EmbedBuilder()
                .setColor(0x00f5d4)
                .setTitle(`🔹 ${idx + 1}. ${offer.displayName}`)
                .setDescription(isEn ? `💵 **Price :** **${offer.exactPrice.toLocaleString()} VP**` : `💵 **Prix :** **${offer.exactPrice.toLocaleString()} VP**`);

            if (offer.displayIcon) {
                skinEmbed.setImage(offer.displayIcon);
            }
            allEmbeds.push(skinEmbed);
        });

        // 3. Featured Bundle (if active)
        const bundleObj = storeData.FeaturedBundle?.Bundle || storeData.FeaturedBundle?.Bundles?.[0];
        if (bundleObj) {
            const bInfo = valorantBundleMap[bundleObj.DataAssetID] || {};
            const bundleEmbed = new EmbedBuilder()
                .setColor(0xffb703)
                .setTitle(isEn ? `📦 Featured Bundle : ${bInfo.displayName || 'Special Collection'}` : `📦 Pack en Vedette : ${bInfo.displayName || 'Collection Spéciale'}`)
                .setDescription(isEn ? `✨ Available for a limited time • [View on RadianiteDB](${YOUR_WEBSITE_URL}/#store)` : `✨ Disponible pour un temps limité • [Consulter sur RadianiteDB](${YOUR_WEBSITE_URL}/#store)`);
            if (bInfo.displayIcon2 || bInfo.displayIcon) {
                bundleEmbed.setImage(bInfo.displayIcon2 || bInfo.displayIcon);
            }
            allEmbeds.push(bundleEmbed);
        }

        // 4. Night Market Notice (if active)
        if (storeData.BonusStore?.BonusStoreOffers) {
            const nmEmbed = new EmbedBuilder()
                .setColor(0x7209b7)
                .setTitle(isEn ? `🌙 Night.Market Detected!` : `🌙 Marché Nocturne Détecté !`)
                .setDescription(isEn ? `👉 **${storeData.BonusStore.BonusStoreOffers.length} discounted offers** are available on your account! Visit **${YOUR_WEBSITE_URL}/#store** to check them.` : `👉 **${storeData.BonusStore.BonusStoreOffers.length} offres à prix réduit** disponibles sur votre compte ! Rendez-vous sur **${YOUR_WEBSITE_URL}/#store** pour les inspecter.`);
            allEmbeds.push(nmEmbed);
        }

        const finalEmbeds = allEmbeds.slice(0, 10);
        await interaction.editReply({ embeds: finalEmbeds });

    } catch (err) {
        console.error("[RadianiteBot] Erreur chargement boutique:", err.response?.data || err.message);
        await interaction.editReply({
            content: isEn 
                ? `❌ **Unable to load your Valorant store.**\nYour session expired or Riot is temporarily rate-limiting. Please renew your session using the buttons below.`
                : `❌ **Impossible de charger votre boutique Valorant.**\nVotre session a expiré ou Riot bloque l'accès temporairement. Veuillez renouveler votre connexion ci-dessous.`,
            components: [createLoginActionRow()]
        });
    }
}

// Helper: Determine User Language from Database ('fr' or 'en')
async function getUserLang(discordId) {
    if (!discordId) return 'fr';
    try {
        const u = await knex('users').where({ discord_id: String(discordId) }).first();
        return u?.language === 'en' ? 'en' : 'fr';
    } catch (e) {
        return 'fr';
    }
}

// Helper: Generate 24h Session Performance Report (Bilingual)
async function generateSessionReport(targetRiotId, isEn = false) {
    const [name, tag] = targetRiotId.split('#');
    if (!name || !tag) return null;

    try {
        const matchesRes = await henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=10`).catch(() => null);
        const matches = matchesRes?.data?.data || [];
        const oneDayAgo = (Date.now() / 1000) - (24 * 3600);
        const recent24h = matches.filter(m => (m.metadata?.game_start || 0) >= oneDayAgo);

        if (recent24h.length === 0) return null;

        let wins = 0, losses = 0;
        let totalKills = 0, totalDeaths = 0, totalAssists = 0;
        let totalScore = 0, totalRounds = 0;
        let totalHeadshots = 0, totalShots = 0;
        const agentCounts = {};

        recent24h.forEach(m => {
            const allP = m.players?.all_players || [];
            const p = allP.find(x => x.name.toLowerCase() === name.toLowerCase());
            if (p) {
                const team = m.teams?.[p.team?.toLowerCase()];
                if (team?.has_won) wins++;
                else losses++;

                totalKills += p.stats?.kills || 0;
                totalDeaths += p.stats?.deaths || 0;
                totalAssists += p.stats?.assists || 0;
                totalScore += p.stats?.score || 0;
                totalRounds += m.metadata?.rounds_played || 1;

                const hs = p.stats?.headshots || 0;
                const bs = p.stats?.bodyshots || 0;
                const ls = p.stats?.legshots || 0;
                totalHeadshots += hs;
                totalShots += (hs + bs + ls);

                const char = p.character || 'Inconnu';
                agentCounts[char] = (agentCounts[char] || 0) + 1;
            }
        });

        const topAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || (isEn ? 'Unknown' : 'Inconnu');
        const overallKD = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;
        const winrate = Math.round((wins / recent24h.length) * 100);
        const avgAcs = totalRounds > 0 ? Math.round(totalScore / totalRounds) : 0;
        const avgHs = totalShots > 0 ? Math.round((totalHeadshots / totalShots) * 100) : 0;

        return new EmbedBuilder()
            .setTitle(isEn ? `📊 24H SESSION REPORT • ${targetRiotId.toUpperCase()}` : `📊 RAPPORT DE SESSION 24H • ${targetRiotId.toUpperCase()}`)
            .setColor(winrate >= 50 ? 0x00f5d4 : 0xff4655)
            .setDescription(
                (isEn
                    ? `🎮 **Matches Played :** **${recent24h.length}** (${wins}W - ${losses}L • **${winrate}% WR**)\n` +
                      `────────────────────────────────────────\n` +
                      `⚔️ **Overall K/D :** **${overallKD}** (${totalKills}K / ${totalDeaths}D / ${totalAssists}A)\n` +
                      `💥 **Average ACS :** **${avgAcs}**\n` +
                      `🎯 **Headshot % :** **${avgHs}%**\n` +
                      `⭐ **Favorite Agent :** **${topAgent}**\n` +
                      `────────────────────────────────────────\n` +
                      `🔗 [View full profile on RadianiteDB](${YOUR_WEBSITE_URL}/#tracker)`
                    : `🎮 **Parties Jouées :** **${recent24h.length}** (${wins}V - ${losses}D • **${winrate}% WR**)\n` +
                      `────────────────────────────────────────\n` +
                      `⚔️ **K/D Global :** **${overallKD}** (${totalKills}K / ${totalDeaths}D / ${totalAssists}A)\n` +
                      `💥 **ACS Moyen :** **${avgAcs}**\n` +
                      `🎯 **Tirs Tête (HS) :** **${avgHs}%**\n` +
                      `⭐ **Agent le plus joué :** **${topAgent}**\n` +
                      `────────────────────────────────────────\n` +
                      `🔗 [Consulter le profil complet sur RadianiteDB](${YOUR_WEBSITE_URL}/#tracker)`
                )
            )
            .setFooter({ text: 'RadianiteDB Session Intelligence' })
            .setTimestamp();

    } catch (e) {
        console.error('[RadianiteBot] generateSessionReport error:', e.message);
        return null;
    }
}

// Handle Slash Command, Button & Modal Interactions
client.on('interactionCreate', async interaction => {
    // 🔘 Handle Button: Open Riot Link Modal
    if (interaction.isButton() && interaction.customId === 'btn_paste_riot_link') {
        const modal = new ModalBuilder()
            .setCustomId('modal_riot_login')
            .setTitle('Lier mon compte Riot Games');

        const linkInput = new TextInputBuilder()
            .setCustomId('riot_link_input')
            .setLabel('Collez votre lien Riot (playvalorant.com...)')
            .setPlaceholder('https://playvalorant.com/opt_in#access_token=ey...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(linkInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
        return;
    }

    // 📋 Handle Modal Submission: Save Persistent Riot Session
    if (interaction.isModalSubmit() && interaction.customId === 'modal_riot_login') {
        await interaction.deferReply({ ephemeral: true });
        const rawLink = interaction.fields.getTextInputValue('riot_link_input');
        const extracted = extractTokensFromUri(rawLink);

        if (!extracted.accessToken) {
            return interaction.editReply({
                content: `❌ **Lien Riot invalide.**\nAssurez-vous de bien copier toute l'adresse URL commençant par \`https://playvalorant.com/opt_in#access_token=...\`.`
            });
        }

        try {
            const sessionData = await buildSessionPayload(extracted.accessToken, extracted.idToken, {});
            const encryptedSession = encryptData(sessionData);

            const existingUser = await knex('users').where({ discord_id: interaction.user.id }).first();
            if (existingUser) {
                await knex('users').where({ discord_id: interaction.user.id }).update({
                    username: interaction.user.username,
                    avatar: interaction.user.displayAvatarURL(),
                    riot_auth: encryptedSession
                });
            } else {
                await knex('users').insert({
                    discord_id: interaction.user.id,
                    username: interaction.user.username,
                    avatar: interaction.user.displayAvatarURL(),
                    riot_auth: encryptedSession
                });
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ COMPTE RIOT LIÉ AVEC SUCCÈS !')
                .setColor(0x00f5d4)
                .setDescription(
                    `👤 **Joueur :** **${sessionData.username}**\n` +
                    `🌐 **Région :** ${sessionData.shard.toUpperCase()}\n\n` +
                    `🔒 *Votre session est chiffrée (AES-256) et reste connectée de façon persistante.*\n` +
                    `👉 Tapez **/boutique** ou **/store** à tout moment pour voir vos skins du jour !`
                );

            return interaction.editReply({ embeds: [successEmbed] });
        } catch (err) {
            return interaction.editReply({
                content: `❌ Impossible de valider le jeton Riot : ${err.message}`
            });
        }
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. /login Command (Direct RSO Authentication or Official Link or Interactive Buttons)
    if (commandName === 'login') {
        await interaction.deferReply({ ephemeral: true });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const username = interaction.options.getString('identifiant');
        const password = interaction.options.getString('mot_de_passe');
        const linkArg = interaction.options.getString('lien');

        // Case A: Link Provided directly in command
        if (linkArg) {
            const extracted = extractTokensFromUri(linkArg);
            if (!extracted.accessToken) {
                return interaction.editReply({
                    content: isEn 
                        ? `❌ **The provided link is invalid.**\nMake sure it includes \`access_token=...\` and originates from Riot Games.`
                        : `❌ **Le lien fourni est invalide.**\nAssurez-vous qu'il contient \`access_token=...\` et provient bien de Riot Games.`
                });
            }

            try {
                const sessionData = await buildSessionPayload(extracted.accessToken, extracted.idToken, {});
                const encryptedSession = encryptData(sessionData);

                const existingUser = await knex('users').where({ discord_id: interaction.user.id }).first();
                if (existingUser) {
                    await knex('users').where({ discord_id: interaction.user.id }).update({
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL(),
                        riot_auth: encryptedSession
                    });
                } else {
                    await knex('users').insert({
                        discord_id: interaction.user.id,
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL(),
                        riot_auth: encryptedSession
                    });
                }

                return interaction.editReply({
                    content: isEn
                        ? `✅ **Riot account linked successfully!**\n👤 **Player :** **${sessionData.username}**\n🌐 **Region :** ${sessionData.shard.toUpperCase()}\n\n👉 Type **/store** or **/boutique** to view your daily shop!`
                        : `✅ **Compte Riot lié avec succès !**\n👤 **Joueur :** **${sessionData.username}**\n🌐 **Région :** ${sessionData.shard.toUpperCase()}\n\n👉 Tapez **/boutique** ou **/store** pour consulter vos 4 skins du jour et vos soldes !`
                });
            } catch (err) {
                return interaction.editReply({
                    content: isEn ? `❌ Unable to validate Riot token: ${err.message}` : `❌ Impossible de valider le jeton Riot : ${err.message}`
                });
            }
        }

        // Case B: Credentials Provided
        if (username && password) {
            try {
                const result = await loginRiotRSO(username, password);

                if (result.requires2FA) {
                    pending2FAMap.set(interaction.user.id, {
                        cookies: result.cookies,
                        expiresAt: Date.now() + 10 * 60 * 1000
                    });

                    return interaction.editReply({
                        content: isEn
                            ? `🔐 **2FA Code Required!**\nA security code was sent to **${result.email}**.\n👉 Type **/2fa code: 123456** to complete login.`
                            : `🔐 **Code 2FA Requis !**\nUn code de sécurité a été envoyé à **${result.email}**.\n👉 Tapez **/2fa code: 123456** pour finaliser votre connexion.`
                    });
                }

                if (!result.success) {
                    return interaction.editReply({
                        content: isEn 
                            ? `❌ **Direct login failed:** ${result.error}\n\n👉 **Tip:** Use the button below to connect via the official Riot Games login page in 1 click:`
                            : `❌ **Échec de connexion directe :** ${result.error}\n\n👉 **Conseil :** Utilisez le bouton ci-dessous pour vous connecter en 1-clic via la page officielle Riot Games :`,
                        components: [createLoginActionRow()]
                    });
                }

                const encryptedSession = encryptData(result.session);

                const existingUser = await knex('users').where({ discord_id: interaction.user.id }).first();
                if (existingUser) {
                    await knex('users').where({ discord_id: interaction.user.id }).update({
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL(),
                        riot_auth: encryptedSession
                    });
                } else {
                    await knex('users').insert({
                        discord_id: interaction.user.id,
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL(),
                        riot_auth: encryptedSession
                    });
                }

                return interaction.editReply({
                    content: isEn
                        ? `✅ **Riot account connected successfully!**\n👤 **Player :** **${result.session.username}**\n🌐 **Region :** ${result.session.shard.toUpperCase()}\n\n🔒 *Your session is encrypted (AES-256) and persistent.*\n👉 Type **/store** or **/boutique** to view your daily skins!`
                        : `✅ **Compte Riot connecté avec succès !**\n👤 **Joueur :** **${result.session.username}**\n🌐 **Région :** ${result.session.shard.toUpperCase()}\n\n🔒 *Votre session est chiffrée (AES-256) et reste persistante.*\n👉 Tapez **/boutique** ou **/store** à tout moment pour voir vos skins du jour !`
                });

            } catch (err) {
                console.error('[RadianiteBot] Erreur /login:', err);
                return interaction.editReply({
                    content: isEn 
                        ? `❌ An unexpected error occurred. Please use the 1-click button below:`
                        : `❌ Une erreur inattendue est survenue. Veuillez utiliser la méthode 1-clic ci-dessous :`,
                    components: [createLoginActionRow()]
                });
            }
        }

        // Case C: Neither provided -> Display Interactive Action Row with Buttons
        const loginEmbed = new EmbedBuilder()
            .setTitle(isEn ? '🔐 RIOT GAMES ACCOUNT LOGIN' : '🔐 CONNEXION COMPTE RIOT GAMES')
            .setColor(0x00f5d4)
            .setDescription(
                isEn
                    ? `Connect your account to access your live Valorant daily store!\n\n` +
                      `**Fast & Recommended Method (1-Click) :**\n` +
                      `1️⃣ Click **"1. Sign in with Riot Games"** below.\n` +
                      `2️⃣ Sign in on the official Riot Games page.\n` +
                      `3️⃣ Copy the redirect URL (\`https://playvalorant.com/opt_in#access_token=...\`).\n` +
                      `4️⃣ Click **"2. Paste connection link"** to validate!`
                    : `Connectez votre compte pour accéder à votre boutique quotidienne Valorant en direct !\n\n` +
                      `**Méthode Rapide & Recommandée (1-Clic) :**\n` +
                      `1️⃣ Cliquez sur **"1. Se connecter sur Riot Games"** ci-dessous.\n` +
                      `2️⃣ Connectez-vous sur la page officielle Riot Games.\n` +
                      `3️⃣ Copiez l'URL de redirection (\`https://playvalorant.com/opt_in#access_token=...\`).\n` +
                      `4️⃣ Cliquez sur **"2. Coller mon lien de connexion"** pour valider !`
            );

        return interaction.editReply({
            embeds: [loginEmbed],
            components: [createLoginActionRow()]
        });
    }

    // 2. /2fa Command
    if (commandName === '2fa') {
        await interaction.deferReply({ ephemeral: true });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const pending = pending2FAMap.get(interaction.user.id);
        if (!pending || Date.now() > pending.expiresAt) {
            pending2FAMap.delete(interaction.user.id);
            return interaction.editReply({
                content: isEn 
                    ? `⚠️ **No pending 2FA challenge found or code expired.**\nPlease run **/login** again.`
                    : `⚠️ **Aucune demande 2FA en attente ou le code a expiré.**\nVeuillez relancer la commande **/login**.`
            });
        }

        const code = interaction.options.getString('code');
        const result = await submit2FACode(code, pending.cookies);
        pending2FAMap.delete(interaction.user.id);

        if (!result.success) {
            return interaction.editReply({
                content: isEn 
                    ? `❌ **${result.error || 'Invalid 2FA code.'}**\nPlease retry **/login** if needed.`
                    : `❌ **${result.error || 'Code 2FA invalide.'}**\nVeuillez relancer **/login** si nécessaire.`
            });
        }

        const encryptedSession = encryptData(result.session);
        const existingUser = await knex('users').where({ discord_id: interaction.user.id }).first();
        if (existingUser) {
            await knex('users').where({ discord_id: interaction.user.id }).update({
                username: interaction.user.username,
                avatar: interaction.user.displayAvatarURL(),
                riot_auth: encryptedSession
            });
        } else {
            await knex('users').insert({
                discord_id: interaction.user.id,
                username: interaction.user.username,
                avatar: interaction.user.displayAvatarURL(),
                riot_auth: encryptedSession
            });
        }

        return interaction.editReply({
            content: isEn 
                ? `✅ **2FA Authentication verified!**\n👤 **Player :** **${result.session.username}**\n\n👉 Type **/store** to view your daily shop!`
                : `✅ **Authentification 2FA validée !**\n👤 **Joueur :** **${result.session.username}**\n\n👉 Tapez **/boutique** ou **/store** pour consulter votre boutique du jour !`
        });
    }

    // 3. /unlink Command
    if (commandName === 'unlink') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        await knex('users').where({ discord_id: interaction.user.id }).update({ riot_auth: null });
        pending2FAMap.delete(interaction.user.id);
        return interaction.reply({
            content: isEn 
                ? `🗑️ **Your Riot account and session have been completely unlinked from the bot.**`
                : `🗑️ **Votre compte et session Riot ont été totalement supprimés du bot.**`,
            ephemeral: true
        });
    }

    // 4. /boutique, /store, /shop Commands
    if (commandName === 'boutique' || commandName === 'store' || commandName === 'shop') {
        const tokenArg = interaction.options.getString('lien_ou_token');
        await handleStoreInteraction(interaction, tokenArg);
    }

    // 5. /setchannel Command
    if (commandName === 'setchannel') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const discord_id = interaction.user.id;
        const channel_id = interaction.channel.id;

        try {
            const user = await knex('users').where({ discord_id }).first();
            if (!user) {
                await knex('users').insert({
                    discord_id,
                    username: interaction.user.username,
                    avatar: interaction.user.displayAvatarURL(),
                    discord_channel_id: channel_id
                });
            } else {
                await knex('users').where({ discord_id }).update({
                    discord_channel_id: channel_id
                });
            }
            
            await interaction.reply({ 
                content: isEn 
                    ? `✅ **Alerts channel configured!** Match notifications for your tracked players will be sent in **#${interaction.channel.name}**.`
                    : `✅ **Salon configuré !** Les notifications de match pour vos joueurs suivis seront envoyées dans **#${interaction.channel.name}**.`,
                ephemeral: true 
            });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: isEn ? 'An error occurred while configuring channel.' : 'Une erreur est survenue lors de la configuration du salon.', ephemeral: true });
        }
    }

    // 6. /wishlist Command (Subcommands: ajouter, retirer, liste)
    if (commandName === 'wishlist') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const sub = interaction.options.getSubcommand();

        if (sub === 'ajouter') {
            await interaction.deferReply({ ephemeral: true });
            const skinName = interaction.options.getString('skin');
            const foundSkin = Object.values(valorantWeaponMap).find(s => s.displayName?.toLowerCase() === skinName.toLowerCase())
                           || Object.values(valorantSkinLevelMap).find(s => s.displayName?.toLowerCase() === skinName.toLowerCase());

            const skinUuid = foundSkin?.uuid || skinName;
            const finalName = foundSkin?.displayName || skinName;

            await knex('wishlist').insert({
                discord_id: interaction.user.id,
                skin_uuid: skinUuid,
                skin_name: finalName
            });

            const embed = new EmbedBuilder()
                .setTitle(isEn ? '⭐ SKIN ADDED TO WISHLIST!' : '⭐ SKIN AJOUTÉ À VOTRE WISHLIST !')
                .setColor(0x00f5d4)
                .setDescription(
                    isEn
                        ? `✨ **${finalName}** is now being tracked!\n\n🔔 As soon as this skin appears in your daily shop (at 02:00 CET), you will automatically receive a **private DM notification**!`
                        : `✨ **${finalName}** est désormais sous surveillance !\n\n` +
                          `🔔 Dès que ce skin apparaîtra dans votre boutique quotidienne (à 02h00), vous recevrez automatiquement **une alerte en message privé (MP)** !`
                );

            if (foundSkin?.displayIcon) {
                embed.setImage(foundSkin.displayIcon);
            }

            return interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'retirer') {
            await interaction.deferReply({ ephemeral: true });
            const skinName = interaction.options.getString('skin');
            await knex('wishlist').where({ discord_id: interaction.user.id, skin_name: skinName }).del();

            return interaction.editReply({
                content: isEn 
                    ? `🗑️ **${skinName}** has been removed from your wishlist.`
                    : `🗑️ Le skin **${skinName}** a été retiré de votre liste de surveillance.`
            });
        }

        if (sub === 'liste') {
            await interaction.deferReply({ ephemeral: true });
            const userWishes = await knex('wishlist').where({ discord_id: interaction.user.id }).select();

            if (userWishes.length === 0) {
                return interaction.editReply({
                    content: isEn
                        ? `📋 **Your wishlist is empty.**\nUse **/wishlist ajouter skin: ...** to track skins and receive automatic DM alerts!`
                        : `📋 **Votre wishlist est vide.**\nUtilisez **/wishlist ajouter skin: ...** pour ajouter vos skins de rêve et recevoir une alerte automatique !`
                });
            }

            const listEmbed = new EmbedBuilder()
                .setTitle(isEn ? `⭐ YOUR WISHLIST WATCHLIST (${userWishes.length})` : `⭐ VOS SKINS SURVEILLÉS (${userWishes.length})`)
                .setColor(0x00f5d4)
                .setDescription(
                    userWishes.map((w, i) => `**${i + 1}.** ${w.skin_name}`).join('\n') +
                    (isEn 
                        ? `\n\n🔔 *A private DM alert will be sent to you as soon as they appear in your store.*`
                        : `\n\n🔔 *Une alerte privée vous sera envoyée dès leur apparition en boutique.*`)
                )
                .setFooter({ text: isEn ? 'RadianiteBot • 24/7 Wishlist Radar' : 'RadianiteBot • Surveillance Wishlist 24/7' });

            return interaction.editReply({ embeds: [listEmbed] });
        }
    }

    // 7. /scout Command (Live Match Intelligence & 10-Player Lobby Radar)
    if (commandName === 'scout') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const dbUser = await knex('users').where({ discord_id: interaction.user.id }).first();
        let userSession = null;

        if (dbUser?.riot_auth) {
            userSession = decryptData(dbUser.riot_auth);
        }

        // Case 1: User is NOT logged in -> Display actionable login guide
        if (!userSession?.accessToken || !userSession?.puuid) {
            const notLoggedEmbed = new EmbedBuilder()
                .setTitle(isEn ? '🔐 LOGIN REQUIRED FOR LIVE SCOUTING' : '🔐 CONNEXION REQUISE POUR LE LIVE SCOUTING')
                .setColor(0xff4655)
                .setDescription(
                    isEn
                        ? `To scout the **10 players in your live match** (current ranks, RR, enemy peak ranks), you must link your Riot Games account!\n\n` +
                          `👉 **How to do it in 2 quick steps:**\n` +
                          `1️⃣ Click **"1. Sign in with Riot Games"** below.\n` +
                          `2️⃣ Copy the redirect URL and click **"2. Paste connection link"**.\n` +
                          `3️⃣ Start a match on Valorant and re-run **/scout**!`
                        : `Pour espionner en direct les **10 joueurs de votre match** (rangs actuels, RR, Peak Ranks adverses), vous devez d'abord lier votre compte Riot Games !\n\n` +
                          `👉 **Comment faire en 2 étapes rapides :**\n` +
                          `1️⃣ Cliquez sur **"1. Se connecter sur Riot Games"** ci-dessous.\n` +
                          `2️⃣ Copiez l'URL de redirection et cliquez sur **"2. Coller mon lien de connexion"**.\n` +
                          `3️⃣ Lancez une partie sur Valorant et réexécutez **/scout** !`
                )
                .setFooter({ text: 'RadianiteBot • Riot Games Live Radar' });

            return interaction.editReply({
                embeds: [notLoggedEmbed],
                components: [createLoginActionRow()]
            });
        }

        // Case 2: User IS logged in -> Probe Riot Core-Game & Pre-Game
        try {
            const shard = userSession.shard || 'eu';
            const region = shard === 'eu' ? 'eu-1' : shard === 'na' ? 'na-1' : shard === 'kr' ? 'kr-1' : 'ap-1';
            const riotHeaders = {
                'Authorization': `Bearer ${userSession.accessToken}`,
                'X-Riot-Entitlements-JWT': userSession.entitlementsToken,
                'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
                'X-Riot-ClientVersion': cachedRiotVersion,
                'User-Agent': 'ShooterGame/14 Windows/10.0.19042.1.256.64bit'
            };

            // A. Check Core-Game (In-Match)
            let liveMatchData = null;
            let isPregame = false;

            try {
                const corePlayerRes = await axios.get(`https://glz-${region}.${shard}.a.pvp.net/core-game/v1/players/${userSession.puuid}`, { headers: riotHeaders });
                if (corePlayerRes.data?.MatchID) {
                    const matchDetails = await axios.get(`https://glz-${region}.${shard}.a.pvp.net/core-game/v1/matches/${corePlayerRes.data.MatchID}`, { headers: riotHeaders });
                    liveMatchData = matchDetails.data;
                }
            } catch (cErr) {}

            // B. Check Pre-Game (Agent Select) if not in core-game
            if (!liveMatchData) {
                try {
                    const prePlayerRes = await axios.get(`https://glz-${region}.${shard}.a.pvp.net/pregame/v1/players/${userSession.puuid}`, { headers: riotHeaders });
                    if (prePlayerRes.data?.MatchID) {
                        const matchDetails = await axios.get(`https://glz-${region}.${shard}.a.pvp.net/pregame/v1/matches/${prePlayerRes.data.MatchID}`, { headers: riotHeaders });
                        liveMatchData = matchDetails.data;
                        isPregame = true;
                    }
                } catch (pErr) {}
            }

            // Case 3: Live match is ACTIVE! Build full 10-player scouting radar
            if (liveMatchData && liveMatchData.Players?.length > 0) {
                const myPlayer = liveMatchData.Players.find(p => p.Subject === userSession.puuid);
                const myTeamId = myPlayer?.TeamID || 'Blue';
                
                const allyTeam = [];
                const enemyTeam = [];

                for (const p of liveMatchData.Players) {
                    let pName = isEn ? 'Player' : 'Joueur';
                    let pTag = '';
                    let pTier = isEn ? 'Unrated' : 'Non-classé';
                    let pPeak = isEn ? 'Unknown' : 'Inconnu';
                    let pRR = 0;

                    try {
                        const mmrRes = await henrikApi.get(`/valorant/v2/by-puuid/mmr/${shard}/${p.Subject}`).catch(() => null);
                        if (mmrRes?.data?.data) {
                            const d = mmrRes.data.data;
                            pName = d.name || (isEn ? 'Player' : 'Joueur');
                            pTag = d.tag || '';
                            pTier = d.current_data?.currenttierpatched || (isEn ? 'Unrated' : 'Non-classé');
                            pRR = d.current_data?.ranking_in_tier || 0;
                            pPeak = d.highest_rank?.patched_tier || (isEn ? 'Unknown' : 'Inconnu');
                        }
                    } catch (hErr) {}

                    const playerInfo = {
                        puuid: p.Subject,
                        riotId: pTag ? `${pName}#${pTag}` : pName,
                        tier: pTier,
                        peak: pPeak,
                        rr: pRR,
                        isSelf: p.Subject === userSession.puuid
                    };

                    if (p.TeamID === myTeamId) {
                        allyTeam.push(playerInfo);
                    } else {
                        enemyTeam.push(playerInfo);
                    }
                    await sleep(250);
                }

                const liveEmbed = new EmbedBuilder()
                    .setTitle(
                        isEn 
                            ? `🔴 LIVE MATCH RADAR • ACTIVE LOBBY (${isPregame ? 'Agent Selection' : 'In Game'})`
                            : `🔴 RADAR LIVE MATCH • LOBBY ACTIF (${isPregame ? 'Sélection des Agents' : 'En Match'})`
                    )
                    .setColor(0x00f5d4)
                    .setDescription(
                        `🎮 **Mode :** ${liveMatchData.ModeID ? path.basename(liveMatchData.ModeID) : (isEn ? 'Competitive' : 'Compétitif')}\n` +
                        `🗺️ **Map ID :** ${liveMatchData.MapID ? path.basename(liveMatchData.MapID) : (isEn ? 'Current' : 'Actuelle')}\n` +
                        `────────────────────────────────────────\n` +
                        (isEn ? `🔵 **ALLY TEAM (${allyTeam.length} players) :**\n` : `🔵 **ÉQUIPE ALLIÉE (${allyTeam.length} joueurs) :**\n`) +
                        allyTeam.map((p, idx) => `**${idx + 1}.** ${p.isSelf ? `👉 **${p.riotId}** (${isEn ? 'You' : 'Vous'})` : `**${p.riotId}**`} — **${p.tier}** (${p.rr} RR) • *Peak: ${p.peak}*`).join('\n') +
                        (isEn ? `\n\n────────────────────────────────────────\n🔴 **ENEMY TEAM (${enemyTeam.length} players) :**\n` : `\n\n────────────────────────────────────────\n🔴 **ÉQUIPE ADVERSE (${enemyTeam.length} joueurs) :**\n`) +
                        enemyTeam.map((p, idx) => `**${idx + 1}.** **${p.riotId}** — **${p.tier}** (${p.rr} RR) • *Peak: ${p.peak}*`).join('\n') +
                        `\n────────────────────────────────────────`
                    )
                    .setFooter({ text: 'RadianiteDB Live Lobby Radar • Riot Games PvP Data' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [liveEmbed] });
            }

            // Case 4: Logged in, but NOT currently in match/agent select
            const notInGameEmbed = new EmbedBuilder()
                .setTitle(isEn ? '⚠️ NO LIVE MATCH DETECTED' : '⚠️ AUCUNE PARTIE EN DIRECT DÉTECTÉE')
                .setColor(0xffb703)
                .setDescription(
                    isEn
                        ? `👤 **Verified Account :** **${userSession.username || 'Connected'}**\n\n` +
                          `The bot did not detect any active match on your account.\n\n` +
                          `👉 **To launch the live radar :**\n` +
                          `1️⃣ Start matchmaking on Valorant.\n` +
                          `2️⃣ Once you enter **agent select** or **in game**, type **/scout** on Discord.\n` +
                          `3️⃣ The bot will instantly display all 10 players, their ranks and Peak Ranks!`
                        : `👤 **Compte vérifié :** **${userSession.username || 'Connecté'}**\n\n` +
                          `Le bot n'a détecté aucune partie en cours sur votre compte.\n\n` +
                          `👉 **Pour lancer le radar de partie :**\n` +
                          `1️⃣ Lancez une recherche de match sur Valorant.\n` +
                          `2️⃣ Dès que vous entrez en **sélection d'agents** ou en **partie**, tapez **/scout** sur Discord.\n` +
                          `3️⃣ Le bot affichera instantanément les 10 joueurs du lobby, leurs rangs et leurs Peak Ranks !`
                )
                .setFooter({ text: 'RadianiteBot • Live Radar' });

            return interaction.editReply({ embeds: [notInGameEmbed] });

        } catch (err) {
            console.error('[RadianiteBot] Erreur /scout live:', err.message);
            return interaction.editReply({
                content: isEn ? `❌ An error occurred while communicating with Riot Games servers: ${err.message}` : `❌ Une erreur est survenue lors de l'interrogation des serveurs de jeu Riot Games : ${err.message}`
            });
        }
    }

    // 8. /classement & /leaderboard Command
    if (commandName === 'classement' || commandName === 'leaderboard') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';

        try {
            const followed = (await knex('followed_players').select()) || [];
            const users = (await knex('users').select()) || [];
            
            const candidateIds = new Set(followed.map(f => f.riot_id).filter(Boolean));
            
            // Also include linked Riot users
            for (const u of users) {
                if (u.riot_auth) {
                    try {
                        const s = decryptData(u.riot_auth);
                        if (s?.username && s.username.includes('#')) {
                            candidateIds.add(s.username);
                        }
                    } catch (e) {}
                }
            }

            const uniqueRiotIds = [...candidateIds];

            if (uniqueRiotIds.length === 0) {
                return interaction.editReply({
                    content: isEn 
                        ? `🏆 No tracked players found in database. Link your account with **/login** or follow players on the website!`
                        : `🏆 Aucun joueur surveillé n'est encore enregistré dans la base de données. Liez votre compte avec **/login** ou suivez des joueurs sur le site !`
                });
            }

            const leaderboardList = [];

            for (const riotId of uniqueRiotIds.slice(0, 10)) {
                const [name, tag] = riotId.split('#');
                if (!name || !tag) continue;
                try {
                    const mmrRes = await henrikApi.get(`/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`).catch(() => null);
                    const currentData = mmrRes?.data?.data?.current_data;
                    if (currentData) {
                        leaderboardList.push({
                            riotId,
                            tierName: currentData.currenttierpatched || 'Unrated',
                            tier: currentData.currenttier || 0,
                            rr: currentData.ranking_in_tier || 0,
                            elo: currentData.elo || 0
                        });
                    }
                } catch (e) {}
                await sleep(500);
            }

            if (leaderboardList.length === 0) {
                return interaction.editReply({
                    content: isEn ? `🏆 Unable to fetch rank data for registered players.` : `🏆 Impossible de récupérer les classements des joueurs enregistrés.`
                });
            }

            leaderboardList.sort((a, b) => b.elo - a.elo);

            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            const lbEmbed = new EmbedBuilder()
                .setTitle(isEn ? `🏆 SERVER COMPETITIVE LEADERBOARD` : `🏆 CLASSEMENT COMPÉTITIF DU SERVEUR`)
                .setColor(0xffb703)
                .setDescription(
                    (isEn ? `Tracked players ranked by **Tier & RR** :\n\n` : `Classement des joueurs suivis ordonné par **Rang & RR** :\n\n`) +
                    leaderboardList.map((p, idx) => {
                        const medal = medals[idx] || '▫️';
                        return `${medal} **${idx + 1}. ${p.riotId}** — **${p.tierName}** (${p.rr} RR)`;
                    }).join('\n\n') +
                    `\n\n────────────────────────────────────────\n` +
                    (isEn ? `🌐 *Updated in real-time via official API.*` : `🌐 *Mis à jour en temps réel via l'API officielle.*`)
                )
                .setThumbnail('https://media.valorant-api.com/competitivetiers/03621f52-4cd8-5eab-4e5e-a4b5d63f9157/27/smallicon.png')
                .setTimestamp();

            return interaction.editReply({ embeds: [lbEmbed] });

        } catch (err) {
            console.error('[RadianiteBot] Erreur /classement:', err);
            return interaction.editReply({ content: isEn ? `❌ Error calculating leaderboard.` : `❌ Erreur lors du calcul du classement.` });
        }
    }

    // 9. /session Command (Past 24h Session Summary)
    if (commandName === 'session') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        let targetRiotId = interaction.options.getString('joueur');

        if (!targetRiotId) {
            const user = await knex('users').where({ discord_id: interaction.user.id }).first();
            if (user?.riot_auth) {
                const s = decryptData(user.riot_auth);
                if (s?.username && s.username.includes('#')) targetRiotId = s.username;
            }
            if (!targetRiotId) {
                const sub = await knex('followed_players').where({ user_id: user?.id || 0 }).first();
                if (sub) targetRiotId = sub.riot_id;
            }
        }

        if (!targetRiotId || !targetRiotId.includes('#')) {
            return interaction.editReply({
                content: isEn ? `❌ **Please specify a player :** \`/session joueur: Player#TAG\`` : `❌ **Veuillez préciser un joueur :** \`/session joueur: Pseudo#TAG\``
            });
        }

        const report = await generateSessionReport(targetRiotId, isEn);
        if (!report) {
            return interaction.editReply({
                content: isEn 
                    ? `ℹ️ **No matches played in the last 24 hours for ${targetRiotId}.**`
                    : `ℹ️ **Aucune partie jouée sur les dernières 24h pour ${targetRiotId}.**`
            });
        }

        return interaction.editReply({ embeds: [report] });
    }

    // 10. /language or /langue Command
    if (commandName === 'language' || commandName === 'langue') {
        const chosenLang = interaction.options.getString('langue') || 'fr';
        const discord_id = interaction.user.id;

        try {
            const user = await knex('users').where({ discord_id }).first();
            if (user) {
                await knex('users').where({ discord_id }).update({ language: chosenLang });
            } else {
                await knex('users').insert({
                    discord_id,
                    username: interaction.user.username,
                    avatar: interaction.user.displayAvatarURL(),
                    language: chosenLang
                });
            }

            const isFr = chosenLang === 'fr';
            return interaction.reply({
                content: isFr 
                    ? `🇫🇷 **Langue définie sur Français !** Vos alertes de match et notifications de salon seront envoyées en français.`
                    : `🇺🇸 **Language set to English!** Your match alerts and channel notifications will now be sent in English.`,
                ephemeral: true
            });
        } catch (err) {
            console.error('[RadianiteBot] Erreur /language:', err);
            return interaction.reply({ content: 'Une erreur est survenue lors de la configuration de la langue.', ephemeral: true });
        }
    }
});

// Autocomplete Interaction Handler for Wishlist
client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete() && interaction.commandName === 'wishlist') {
        const focusedOption = interaction.options.getFocused(true);
        const focusedValue = (focusedOption.value || '').toLowerCase();
        const sub = interaction.options.getSubcommand();

        if (sub === 'retirer') {
            const userWishes = await knex('wishlist').where({ discord_id: interaction.user.id }).select();
            const filtered = userWishes
                .filter(w => w.skin_name.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(w => ({ name: w.skin_name, value: w.skin_name }));
            return interaction.respond(filtered);
        } else {
            const allSkins = Object.values(valorantWeaponMap)
                .filter(s => s.displayName && !s.displayName.toLowerCase().includes('standard') && !s.displayName.toLowerCase().includes('aléatoire'))
                .filter(s => s.displayName.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(s => ({ name: s.displayName, value: s.displayName }));
            return interaction.respond(allSkins);
        }
    }
});

// Sleep helper to prevent API rate-limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- VALORANT MATCH ENGINE (WITH DUOQ, TRIOQ, 5-STACK GROUPING) ---
async function checkFollowedPlayers() {
    console.log('[RadianiteBot] Vérification des nouveaux matchs en cours...');
    
    // 1. Get all active subscriptions
    const subscriptions = await knex('followed_players')
        .join('users', 'users.id', 'followed_players.user_id')
        .whereNotNull('users.discord_channel_id')
        .select(
            'followed_players.riot_id',
            'users.discord_channel_id',
            'users.discord_id',
            'users.show_rank_wheel',
            'users.notify_mentions',
            'users.notify_rankup_only',
            'users.notify_game_modes',
            'users.language'
        );

    if (subscriptions.length === 0) return;

    // 2. Fetch latest match for each followed player (any mode)
    const uniqueRiotIds = [...new Set(subscriptions.map(s => s.riot_id))];
    const latestPlayerMatches = new Map(); // riot_id -> { match, matchId, playerStats, team, rrChange, isCompetitive, isDeathmatch, modeDisplay, placement, dmScore, isDmWin }

    for (const riotId of uniqueRiotIds) {
        try {
            const [name, tag] = riotId.split('#');
            if (!name || !tag) continue;

            // Fetch latest match across all modes
            const matchRes = await henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=1`);
            if (!matchRes.data?.data || matchRes.data.data.length === 0) continue;

            const latestMatch = matchRes.data.data[0];
            const latestMatchId = latestMatch.metadata.matchid;

            const memory = await knex('bot_memory').where({ riot_id: riotId }).first();
            const lastAnnouncedId = memory ? memory.last_match_id : null;

            if (latestMatchId !== lastAnnouncedId) {
                // New match found!
                const allPlayers = latestMatch.players?.all_players || [];
                const playerStats = allPlayers.find(p => p.name.toLowerCase() === name.toLowerCase() && (!p.tag || p.tag.toLowerCase() === tag.toLowerCase())) 
                                 || allPlayers.find(p => p.name.toLowerCase() === name.toLowerCase());

                if (playerStats) {
                    const rawMode = (latestMatch.metadata?.mode || latestMatch.metadata?.queue || 'Competitive').toLowerCase();
                    const isCompetitive = rawMode.includes('competitive') || rawMode.includes('ranked');
                    const isDeathmatch = rawMode.includes('deathmatch') || rawMode.includes('dm');
                    const isSwiftplay = rawMode.includes('swiftplay');
                    const isSpikeRush = rawMode.includes('spikerush') || rawMode.includes('spike_rush');
                    const isTDM = rawMode.includes('teamdeathmatch') || rawMode.includes('hurm') || rawMode.includes('team_deathmatch');
                    const isUnrated = rawMode.includes('unrated');

                    let modeDisplay = 'Compétitif';
                    if (isCompetitive) modeDisplay = 'Compétitif';
                    else if (isDeathmatch) modeDisplay = 'Match à mort (Deathmatch)';
                    else if (isTDM) modeDisplay = 'Match à mort par équipe (TDM)';
                    else if (isSwiftplay) modeDisplay = 'Véloce (Swiftplay)';
                    else if (isSpikeRush) modeDisplay = 'Spike Rush';
                    else if (isUnrated) modeDisplay = 'Non-classé (Unrated)';
                    else if (rawMode.includes('premier')) modeDisplay = 'Premier';
                    else if (rawMode.includes('custom')) modeDisplay = 'Partie personnalisée';
                    else modeDisplay = latestMatch.metadata?.mode || 'Partie';

                    const team = latestMatch.teams?.[playerStats.team?.toLowerCase()] || { has_won: false, rounds_won: 0, rounds_lost: 0 };
                    
                    // RR change & dynamic Rank Wheel are ONLY fetched for Ranked/Competitive
                    let rrChange = null;
                    let rankWheelUrl = null;
                    let isRankUp = false;
                    if (isCompetitive) {
                        try {
                            const mmrHistRes = await henrikApi.get(`/valorant/v1/mmr-history/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
                            const history = mmrHistRes.data?.data || [];
                            // Match exact matchId or fallback to latest match entry in history
                            const matchedEntry = history.find(h => h.match_id === latestMatchId) || history[0];
                            if (matchedEntry) {
                                const rawChangeNum = matchedEntry.mmr_change_to_last_game || 0;
                                rrChange = rawChangeNum > 0 ? `+${rawChangeNum} RR` : `${rawChangeNum} RR`;
                                isRankUp = matchedEntry.ranking_in_tier + rawChangeNum > 100;
                                const currentRR = matchedEntry.ranking_in_tier ?? 50;
                                const rankTierNum = matchedEntry.currenttier || 18;
                                rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?rr=${currentRR}&change=${rawChangeNum}&tier=${rankTierNum}&size=360&t=${Date.now()}`;
                            }
                        } catch (e) {
                            // Direct HenrikDev v2 fallback
                            try {
                                const mmrRes = await henrikApi.get(`/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
                                const cData = mmrRes.data?.data?.current_data;
                                if (cData) {
                                    const rawChangeNum = cData.mmr_change_to_last_game || 0;
                                    rrChange = rawChangeNum > 0 ? `+${rawChangeNum} RR` : `${rawChangeNum} RR`;
                                    isRankUp = cData.ranking_in_tier + rawChangeNum > 100;
                                    const currentRR = cData.ranking_in_tier || 50;
                                    const rankTierNum = cData.currenttier || 18;
                                    rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?rr=${currentRR}&change=${rawChangeNum}&tier=${rankTierNum}&size=360&t=${Date.now()}`;
                                }
                            } catch (hErr) {}
                        }
                    }

                    // Deathmatch specific placement & score
                    let placement = 1;
                    let dmScore = '';
                    let isDmWin = false;
                    if (isDeathmatch) {
                        const sorted = [...allPlayers].sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0));
                        placement = sorted.findIndex(p => p.name.toLowerCase() === name.toLowerCase()) + 1;
                        if (placement === 0) placement = 1;
                        isDmWin = placement === 1;
                        const kills = playerStats.stats?.kills || 0;
                        const deaths = playerStats.stats?.deaths || 0;
                        dmScore = `${kills} Kills / ${deaths} Morts`;
                    }

                    latestPlayerMatches.set(riotId, {
                        riotId,
                        name,
                        tag,
                        match: latestMatch,
                        matchId: latestMatchId,
                        playerStats,
                        team,
                        rrChange,
                        rankWheelUrl,
                        isRankUp,
                        isCompetitive,
                        isDeathmatch,
                        modeDisplay,
                        placement,
                        dmScore,
                        isDmWin
                    });
                }
            }
        } catch (err) {
            if (err.response?.status === 429) {
                console.warn('[RadianiteBot] HenrikDev API Rate limit atteinte ! Pause 30s...');
                await sleep(30000);
            } else {
                console.warn(`[RadianiteBot] Erreur match pour ${riotId}:`, err.message);
            }
        }
        await sleep(3000); // 3 seconds between player requests
    }

    // 3. Group by User/Channel and Match ID (DuoQ / TrioQ / 5-STACK grouping)
    const userSubs = new Map(); // discord_id -> { channel, user, showRankWheel, notifyMentions, notifyRankupOnly, notifyGameModes, language, followedRiotIds: [] }
    for (const sub of subscriptions) {
        if (!userSubs.has(sub.discord_id)) {
            let gameModes = null;
            try { gameModes = sub.notify_game_modes ? JSON.parse(sub.notify_game_modes) : null; } catch {}
            userSubs.set(sub.discord_id, {
                channel: sub.discord_channel_id,
                user: sub.discord_id,
                showRankWheel: sub.show_rank_wheel !== false,
                notifyMentions: sub.notify_mentions !== false,
                notifyRankupOnly: sub.notify_rankup_only === true,
                notifyGameModes: Array.isArray(gameModes) && gameModes.length > 0 ? gameModes : null,
                language: sub.language || 'en',
                followedRiotIds: []
            });
        }
        userSubs.get(sub.discord_id).followedRiotIds.push(sub.riot_id);
    }

    for (const [discordId, userData] of userSubs.entries()) {
        // Find which new matches occurred for this user's followed players
        const userNewMatches = new Map(); // matchId -> [playerMatchData1, playerMatchData2, ...]

        for (const riotId of userData.followedRiotIds) {
            if (latestPlayerMatches.has(riotId)) {
                const matchData = latestPlayerMatches.get(riotId);
                
                // Respect notify_rankup_only
                if (userData.notifyRankupOnly && (!matchData.isCompetitive || !matchData.isRankUp)) continue;

                // Respect notify_game_modes filter
                if (userData.notifyGameModes) {
                    const rawMode = (matchData.match.metadata?.mode || matchData.match.metadata?.queue || '').toLowerCase();
                    const matchedMode = (() => {
                        if (rawMode.includes('competitive') || rawMode.includes('ranked')) return 'competitive';
                        if (rawMode.includes('deathmatch') && !rawMode.includes('team')) return 'deathmatch';
                        if (rawMode.includes('teamdeathmatch') || rawMode.includes('hurm') || rawMode.includes('team_deathmatch')) return 'teamdeathmatch';
                        if (rawMode.includes('swiftplay')) return 'swiftplay';
                        if (rawMode.includes('spikerush') || rawMode.includes('spike_rush')) return 'spikerush';
                        if (rawMode.includes('unrated')) return 'unrated';
                        if (rawMode.includes('premier')) return 'premier';
                        if (rawMode.includes('custom')) return 'custom';
                        return rawMode;
                    })();
                    if (!userData.notifyGameModes.includes(matchedMode)) continue;
                }
                
                if (!userNewMatches.has(matchData.matchId)) {
                    userNewMatches.set(matchData.matchId, []);
                }
                userNewMatches.get(matchData.matchId).push(matchData);
            }
        }

        // Send notifications grouped by match
        for (const [matchId, squadPlayers] of userNewMatches.entries()) {
            try {
                const channel = await client.channels.fetch(userData.channel);
                if (!channel) continue;

                const first = squadPlayers[0];
                const match = first.match;
                const isCompetitive = first.isCompetitive;
                const isDeathmatch = first.isDeathmatch;
                const team = first.team;
                const isEn = (userData.language || 'en') === 'en';

                let modeDisplay = first.modeDisplay;
                if (isCompetitive) modeDisplay = isEn ? 'Competitive' : 'Compétitif';
                else if (isDeathmatch) modeDisplay = isEn ? 'Deathmatch' : 'Match à Mort';
                else if (first.match.metadata?.mode?.toLowerCase().includes('swiftplay')) modeDisplay = isEn ? 'Swiftplay' : 'Partie Véloce';
                else if (first.match.metadata?.mode?.toLowerCase().includes('unrated')) modeDisplay = isEn ? 'Unrated' : 'Non-classé';

                const isSquad = squadPlayers.length > 1;
                const squadTitle = squadPlayers.length === 2 ? 'DUOQ' : squadPlayers.length === 3 ? 'TRIOQ' : squadPlayers.length === 5 ? '5-STACK' : `${squadPlayers.length}-STACK`;

                let title = '';
                let color = 0x00f5d4;

                if (isDeathmatch) {
                    const isDmWin = first.isDmWin;
                    color = isDmWin ? 0x00f5d4 : (first.placement <= 3 ? 0xffb703 : 0xff4655);
                    const winLabel = isEn ? 'VICTORY' : 'VICTOIRE';
                    title = isSquad 
                        ? (isEn ? `🎯 DEATHMATCH • SQUAD ${squadTitle}` : `🎯 MATCH À MORT • SQUAD ${squadTitle}`)
                        : `${isDmWin ? `🏆 ${winLabel}` : `💀 TOP ${first.placement}`} (${first.dmScore}) • ${first.riotId}`;
                } else {
                    const hasWon = team.has_won;
                    color = hasWon ? 0x00f5d4 : 0xff4655;
                    const resultText = hasWon ? (isEn ? 'VICTORY' : 'VICTOIRE') : (isEn ? 'DEFEAT' : 'DÉFAITE');
                    title = isSquad 
                        ? `🔥 ${resultText} (${team.rounds_won} - ${team.rounds_lost}) • SQUAD ${squadTitle}` 
                        : `⚡ ${resultText} (${team.rounds_won} - ${team.rounds_lost}) • ${first.riotId}`;
                }

                // Main Match Embed
                const mainEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setColor(color)
                    .setDescription(
                        `🗺️ **Map :** ${match.metadata.map} • ⏱️ **Mode :** ${modeDisplay}\n` +
                        `🕒 **Date :** <t:${match.metadata.game_start}:R>\n` +
                        `────────────────────────────────────────`
                    )
                    .setTimestamp(new Date(match.metadata.game_start * 1000));

                if (isCompetitive && first.rankWheelUrl && userData.showRankWheel !== false) {
                    mainEmbed.setThumbnail(first.rankWheelUrl);
                } else if (first.playerStats?.assets?.agent?.small) {
                    mainEmbed.setThumbnail(first.playerStats.assets.agent.small);
                }

                const embedsToSend = [mainEmbed];

                squadPlayers.forEach((pData, idx) => {
                    const p = pData.playerStats;
                    const kills = p.stats?.kills || 0;
                    const deaths = p.stats?.deaths || 0;
                    const assists = p.stats?.assists || 0;
                    const kd = deaths === 0 ? kills : (kills / deaths).toFixed(2);
                    const acs = Math.round((p.stats?.score || 0) / (match.metadata.rounds_played || 1));
                    
                    const totalShots = (p.stats?.headshots || 0) + (p.stats?.bodyshots || 0) + (p.stats?.legshots || 0);
                    const hsPercent = totalShots > 0 ? Math.round((p.stats.headshots / totalShots) * 100) : 0;

                    if (pData.isDeathmatch) {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character}) • ${pData.isDmWin ? (isEn ? '🏆 Top 1 (Victory)' : '🏆 Top 1 (Victoire)') : `Top ${pData.placement}/${match.players?.all_players?.length || 12}`}`,
                            value: `🎯 **Score :** **${kills} Kills / ${deaths} ${isEn ? 'Deaths' : 'Morts'}** (${kd} KD)\n` +
                                   `💥 **Assists :** ${assists} | 🎯 **${isEn ? 'Headshots' : 'Tirs Tête'} :** ${p.stats?.headshots || 0} (${hsPercent}%)\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else if (pData.isCompetitive) {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **${isEn ? 'Headshot %' : 'Tirs Tête'} :** ${hsPercent}%\n` +
                                   `📈 **${isEn ? 'RR Change' : 'Évolution RR'} :** **${pData.rrChange || '±0 RR'}**\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **${isEn ? 'Headshot %' : 'Tirs Tête'} :** ${hsPercent}%\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    }

                    if (p.assets?.card?.wide || p.assets?.card?.large) {
                        const bannerEmbed = new EmbedBuilder()
                            .setColor(color)
                            .setImage(p.assets.card.wide || p.assets.card.large)
                            .setFooter({ text: `${pData.riotId} • ${p.character} • ${modeDisplay}` });
                        embedsToSend.push(bannerEmbed);
                    }
                });

                const finalEmbeds = embedsToSend.slice(0, 10);

                const mentionPrefix = userData.notifyMentions ? `<@${userData.user}>, ` : '';
                const matchMsg = isEn 
                    ? `${mentionPrefix}${isSquad ? `your tracked players in **${squadTitle}** finished their match (${modeDisplay})!` : `**${first.riotId}** finished their match (${modeDisplay})!`}`
                    : `${mentionPrefix}${isSquad ? `vos joueurs suivis en **${squadTitle}** ont terminé leur partie (${modeDisplay}) !` : `**${first.riotId}** a terminé sa partie (${modeDisplay}) !`}`;

                await channel.send({
                    content: matchMsg,
                    embeds: finalEmbeds
                });

            } catch (err) {
                console.error(`[RadianiteBot] Erreur envoi vers salon ${userData.channel}:`, err.message);
            }
        }
    }

    // 4. Update memory for all processed players
    for (const [riotId, matchData] of latestPlayerMatches.entries()) {
        try {
            const memory = await knex('bot_memory').where({ riot_id: riotId }).first();
            if (memory) {
                await knex('bot_memory').where({ riot_id: riotId }).update({ last_match_id: matchData.matchId });
            } else {
                await knex('bot_memory').insert({ riot_id: riotId, last_match_id: matchData.matchId });
            }
        } catch (e) {
            console.error(`[RadianiteBot] Erreur mise à jour mémoire pour ${riotId}:`, e.message);
        }
    }

    console.log('[RadianiteBot] Vérification des matchs terminée avec succès.');
}

// --- CRON: DAILY 10h00 SESSION REPORT ---
async function sendDailySessionRecap() {
    console.log('[RadianiteBot] ⏰ Envoi automatique des rapports de session de 10h00...');
    try {
        const subscriptions = await knex('followed_players')
            .join('users', 'users.id', 'followed_players.user_id')
            .whereNotNull('users.discord_channel_id')
            .select('followed_players.riot_id', 'users.discord_channel_id', 'users.discord_id', 'users.language');

        for (const sub of subscriptions) {
            try {
                const isEn = sub.language === 'en';
                const report = await generateSessionReport(sub.riot_id, isEn);
                if (report) {
                    const channel = await client.channels.fetch(sub.discord_channel_id);
                    if (channel) {
                        await channel.send({
                            content: isEn 
                                ? `☀️ <@${sub.discord_id}>, here is your 24h **Valorant session briefing** for **${sub.riot_id}**:`
                                : `☀️ <@${sub.discord_id}>, voici votre **briefing de session Valorant** des dernières 24h pour **${sub.riot_id}** :`,
                            embeds: [report]
                        });
                    }
                }
            } catch (err) {
                console.warn(`[RadianiteBot] Erreur envoi session pour ${sub.riot_id}:`, err.message);
            }
            await sleep(2000);
        }
    } catch (err) {
        console.error('[RadianiteBot] Erreur globale cron 10h:', err);
    }
}

// --- CRON: DAILY 02h05 WISHLIST CHECKER & DM ALERTS ---
async function checkWishlists() {
    console.log('[RadianiteBot] ⭐ Vérification des Wishlists skins en cours...');
    try {
        const users = await knex('users').whereNotNull('riot_auth').select('discord_id', 'riot_auth', 'language');
        for (const u of users) {
            try {
                const wishes = await knex('wishlist').where({ discord_id: u.discord_id }).select();
                if (wishes.length === 0) continue;

                const session = decryptData(u.riot_auth);
                if (!session) continue;

                const storeResult = await fetchStorefront(session, cachedRiotVersion);
                const dailyOffers = storeResult.store?.SkinsPanelLayout?.SingleItemOffers || [];

                for (const wish of wishes) {
                    const matchedUuid = dailyOffers.find(uuid => {
                        const skin = valorantSkinLevelMap[uuid] || valorantWeaponMap[uuid];
                        return uuid === wish.skin_uuid || (skin && skin.displayName?.toLowerCase() === wish.skin_name.toLowerCase());
                    });

                    if (matchedUuid) {
                        const skinInfo = valorantSkinLevelMap[matchedUuid] || valorantWeaponMap[matchedUuid] || { displayName: wish.skin_name };
                        const discordUser = await client.users.fetch(u.discord_id).catch(() => null);

                        if (discordUser) {
                            const isEn = u.language === 'en';
                            const alertEmbed = new EmbedBuilder()
                                .setTitle(isEn ? '🚨 WISHLIST ALERT • YOUR SKIN IS IN THE STORE!' : '🚨 ALERTE WISHLIST • VOTRE SKIN EST EN BOUTIQUE !')
                                .setColor(0x00f5d4)
                                .setDescription(
                                    isEn
                                        ? `🎉 Great news! The skin **${skinInfo.displayName}** is available in your Valorant store today!\n\n` +
                                          `💵 **Price :** 1,775 VP\n` +
                                          `⏱️ **Notice :** It will disappear at the next daily rotation at 02:00 CET.\n\n` +
                                          `👉 Type **/store** on Discord to inspect all your daily offers!`
                                        : `🎉 Bonne nouvelle ! Le skin **${skinInfo.displayName}** est disponible dans votre boutique Valorant aujourd'hui !\n\n` +
                                          `💵 **Prix :** 1,775 VP\n` +
                                          `⏱️ **Attention :** Il disparaîtra lors de la prochaine rotation quotidienne à 02h00.\n\n` +
                                          `👉 Tapez **/boutique** sur Discord pour voir l'ensemble de vos offres du jour !`
                                )
                                .setImage(skinInfo.displayIcon || null)
                                .setThumbnail('https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png')
                                .setTimestamp();

                            await discordUser.send({ embeds: [alertEmbed] }).catch(() => {
                                console.log(`[Wishlist] Impossible d'envoyer un MP à ${u.discord_id} (DMs fermés).`);
                            });
                        }
                    }
                }
            } catch (uErr) {
                console.warn(`[Wishlist] Notice utilisateur ${u.discord_id}:`, uErr.message);
            }
            await sleep(3000);
        }
    } catch (err) {
        console.error('[RadianiteBot] Erreur globale wishlist cron:', err);
    }
}

// Check followed players matches every 3 minutes
cron.schedule('*/3 * * * *', checkFollowedPlayers);

// Check store wishlists at 02h05 CET every day
cron.schedule('5 2 * * *', checkWishlists);

// Send daily session briefing automatically at 10h00 AM every day
cron.schedule('0 10 * * *', sendDailySessionRecap);

client.login(BOT_TOKEN);
