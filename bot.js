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
        name: 'settings',
        description: 'Configure bot settings, alert channels, mentions, rank-up notifications and language.',
    },
    {
        name: 'config',
        description: 'Configure bot settings, alert channels, mentions and language (alias /settings).',
    },
    {
        name: 'history',
        description: 'Match history (5/page), net RR wheel, current rank and lobby scoreboards.',
        options: [
            {
                name: 'player',
                description: 'Optional: Player name#TAG (e.g. TenZ#SEN or Boaster#FNC)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'mode',
                description: 'Filter game mode (Competitive by default)',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: '🏆 Competitive / Ranked', value: 'competitive' },
                    { name: '🌐 All Modes', value: 'all' },
                    { name: '🎯 Deathmatch', value: 'deathmatch' },
                    { name: '⚡ Swiftplay', value: 'swiftplay' },
                    { name: '🥊 Team Deathmatch', value: 'teamdeathmatch' },
                    { name: '🎮 Unrated', value: 'unrated' }
                ]
            }
        ]
    },
    {
        name: 'store',
        description: 'Check your live 24h Valorant daily store, wallet balances and Night Market.',
        options: [
            {
                name: 'link_or_token',
                description: 'Optional: Paste your official Riot link or access token',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'session',
        description: 'Daily match performance recap, net RR win/loss, and KD telemetry.',
        options: [
            {
                name: 'player',
                description: 'Optional: Player name#TAG to inspect',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'wishlist',
        description: 'Manage skin wishlist and receive automated DM alerts upon rotation drops.',
        options: [
            {
                name: 'add',
                description: 'Add a weapon skin to your wishlist',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'skin',
                        description: 'Weapon skin name (autocomplete supported)',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            {
                name: 'remove',
                description: 'Remove a weapon skin from your wishlist',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'skin',
                        description: 'Weapon skin name to remove',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            {
                name: 'list',
                description: 'Display all your currently tracked wishlist skins',
                type: ApplicationCommandOptionType.Subcommand
            }
        ]
    },
    {
        name: 'leaderboard',
        description: 'Server competitive leaderboard of followed players (RR, Rank, KD).',
    },
    {
        name: 'follow',
        description: 'Follow a player to receive automated match results & rank-up alerts in this server.',
        options: [
            {
                name: 'player',
                description: 'Player name#TAG to follow (e.g. TenZ#SEN)',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'unfollow',
        description: 'Stop tracking a player in this server.',
        options: [
            {
                name: 'player',
                description: 'Player name#TAG to unfollow',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'setchannel',
        description: 'Set target Discord channel for post-match summary and rank-up alerts.',
        options: [
            {
                name: 'channel',
                description: 'Optional: Channel to send alerts to (defaults to current channel)',
                type: ApplicationCommandOptionType.Channel,
                required: false
            }
        ]
    },
    {
        name: 'language',
        description: 'Change bot language for this server or user.',
        options: [
            {
                name: 'lang',
                description: 'Select language',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: '🇺🇸 English', value: 'en' },
                    { name: '🇫🇷 Français', value: 'fr' },
                    { name: '🇪🇸 Español', value: 'es' },
                    { name: '🇩🇪 Deutsch', value: 'de' }
                ]
            }
        ]
    },
    {
        name: 'login',
        description: 'Link your Riot account for live store & match tracking (AES-256 encrypted).',
        options: [
            {
                name: 'username',
                description: 'Riot Games account username',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'password',
                description: 'Riot Games account password',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'link',
                description: 'Official Riot auth link (playvalorant.com/opt_in...)',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: '2fa',
        description: 'Submit 6-digit email 2FA verification code.',
        options: [
            {
                name: 'code',
                description: 'The 6-digit 2FA code received by email',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'unlink',
        description: 'Permanently remove your saved Riot credentials from the bot.',
    },
    {
        name: 'help',
        description: 'Show all available RadianiteBot commands and features.',
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

// Bot Analytics Trackers (persisted in Supabase PostgreSQL)
async function incrementBotStat(key, amount = 1) {
    try {
        const existing = await knex('bot_analytics').where({ key }).first();
        if (existing) {
            await knex('bot_analytics').where({ key }).update({
                count: parseInt(existing.count || 0) + amount,
                updated_at: new Date().toISOString()
            });
        } else {
            await knex('bot_analytics').insert({
                key,
                count: amount,
                updated_at: new Date().toISOString()
            });
        }
    } catch (e) {
        console.warn('[Bot] incrementBotStat error:', e.message);
    }
}

async function syncGuildsAnalytics() {
    try {
        const guilds = client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            icon: g.iconURL({ dynamic: true }) || null,
            ownerId: g.ownerId,
            joinedAt: g.joinedTimestamp
        }));

        const now = new Date().toISOString();
        const existing = await knex('bot_analytics').where({ key: 'bot_guilds' }).first();
        if (existing) {
            await knex('bot_analytics').where({ key: 'bot_guilds' }).update({
                count: guilds.length,
                meta: JSON.stringify(guilds),
                updated_at: now
            });
        } else {
            await knex('bot_analytics').insert({
                key: 'bot_guilds',
                count: guilds.length,
                meta: JSON.stringify(guilds),
                updated_at: now
            });
        }

        // Also ensure each guild has a default config entry in guild_configs
        for (const g of guilds) {
            try {
                const gc = await knex('guild_configs').where({ guild_id: g.id }).first();
                if (!gc) {
                    await knex('guild_configs').insert({
                        guild_id: g.id,
                        guild_name: g.name,
                        guild_icon: g.icon,
                        language: 'en'
                    });
                }
            } catch (e) {}
        }
        console.log(`[Bot] Guild analytics synced: ${guilds.length} servers.`);
    } catch (e) {
        console.warn('[Bot] syncGuildsAnalytics error:', e.message);
    }
}

client.once('ready', async () => {
    console.log(`[RadianiteBot] Connecté en tant que ${client.user.tag} !`);
    await refreshValorantData();
    await registerSlashCommands();
    await syncGuildsAnalytics();

    // Periodic sync every 5 minutes so panel always shows live guild/member counts
    setInterval(syncGuildsAnalytics, 5 * 60 * 1000);
});

// Auto-register on new guild join & post interactive English welcome embed
client.on('guildCreate', async guild => {
    await syncGuildsAnalytics();
    await incrementBotStat('guilds_joined');
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id),
            { body: commands }
        );
    } catch (e) {}

    // Save default guild config in English
    try {
        await knex('guild_configs').insert({
            guild_id: guild.id,
            guild_name: guild.name,
            guild_icon: guild.iconURL({ dynamic: true }) || null,
            language: 'en'
        });
    } catch (e) {}

    // Post rich English presentation embed to server system or first text channel
    try {
        let channel = guild.systemChannel;
        if (!channel || !channel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
            channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks']));
        }

        if (channel) {
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('⚡ RADIANITEBOT // VALORANT TELEMETRY COMPANION')
                .setColor(0x00f5d4)
                .setDescription(`**Thank you for inviting RadianiteBot to ${guild.name}!** 🎯\n\nRadianiteBot is your high-precision Valorant companion for real-time match tracking, 24h store inspection, automated rank alerts, and squad leaderboards.`)
                .addFields(
                    { name: '📊 `/history [player]`', value: '50+ match archives with 5-game net RR Wheel and 10-player interactive lobby scoreboards.', inline: false },
                    { name: '🛒 `/store` & `/wishlist`', value: 'Check your 24h rotating skin store, and set alerts for your favorite skins.', inline: false },
                    { name: '📈 `/session [player]`', value: '24h session performance recap with net RR, Win/Loss and stats.', inline: false },
                    { name: '🏆 `/leaderboard`', value: 'Server squad leaderboard ranking followed players by RR & tier.', inline: false },
                    { name: '👥 `/follow [player]` & `/unfollow`', value: 'Follow players to automatically receive post-match summary cards in your server channel.', inline: false },
                    { name: '🔔 `/setchannel`', value: 'Set the dedicated channel for automatic match notifications.', inline: false }
                )
                .setFooter({ text: 'RadianiteDB Protocol • Select your preferred language below:', iconURL: 'https://www.radianitedb.lol/favicon.png' })
                .setTimestamp();

            const langRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('setlang_en').setLabel('🇺🇸 English').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('setlang_fr').setLabel('🇫🇷 Français').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('setlang_es').setLabel('🇪🇸 Español').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('setlang_de').setLabel('🇩🇪 Deutsch').setStyle(ButtonStyle.Secondary)
            );

            await channel.send({ embeds: [welcomeEmbed], components: [langRow] }).catch(() => {});
        }
    } catch (wErr) {
        console.warn('[GuildCreate] Welcome send notice:', wErr.message);
    }

    // Send DM Notification to Owner
    try {
        const ownerId = process.env.OWNER_DISCORD_ID || 'codedwld';
        let targetUser = null;
        if (/^\d+$/.test(ownerId)) {
            targetUser = await client.users.fetch(ownerId).catch(() => null);
        }
        if (!targetUser) {
            targetUser = client.users.cache.find(u => 
                u.username.toLowerCase() === 'codedwld' || 
                u.tag?.toLowerCase() === 'codedwld' || 
                u.globalName?.toLowerCase() === 'codedwld'
            );
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

            await targetUser.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (notifErr) {}
});

client.on('guildDelete', async () => {
    await syncGuildsAnalytics();
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

// Helper: Generate Rich Interactive Settings Payload
async function renderSettingsPayload(discordId, guildId, isEn) {
    let user = await knex('users').where({ discord_id: String(discordId) }).first();
    let guildConfig = guildId ? await knex('guild_configs').where({ guild_id: String(guildId) }).first() : null;

    const lang = user?.language || guildConfig?.language || (isEn ? 'en' : 'fr');
    const isEnglish = (lang === 'en');

    const channelId = user?.discord_channel_id || guildConfig?.channel_id || null;
    const notifyMentions = (user?.notify_mentions !== false);
    const notifyRankupOnly = Boolean(user?.notify_rankup_only);
    const showRankWheel = (user?.show_rank_wheel !== false);

    // Tracked players
    const followed = user ? await knex('followed_players').where({ user_id: user.id }) : [];
    const trackedListStr = followed.length > 0
        ? followed.map(p => `• \`${p.riot_id}\``).join('\n')
        : (isEnglish ? '*No players followed yet. Use `/follow player: Player#TAG`*' : '*Aucun joueur suivi. Utilisez `/follow player: Pseudo#TAG`*');

    const embed = new EmbedBuilder()
        .setTitle(isEnglish ? '⚙️ RADIANITEBOT // SERVER & USER SETTINGS' : '⚙️ RADIANITEBOT // PARAMÈTRES & CONFIGURATION')
        .setColor(0x00f5d4)
        .setDescription(
            (isEnglish 
                ? `Configure your Valorant match alerts and companion preferences in 1 click below.\n────────────────────────────────────────`
                : `Configurez vos alertes de fin de match et vos préférences en 1 clic ci-dessous.\n────────────────────────────────────────`)
        )
        .addFields(
            {
                name: isEnglish ? '📢 Match Alerts Channel' : '📢 Salon des Alertes de Match',
                value: channelId ? `<#${channelId}> (\`${channelId}\`)` : (isEnglish ? '❌ *Not configured (Click button below to set)*' : '❌ *Non configuré (Cliquez sur le bouton ci-dessous)*'),
                inline: true
            },
            {
                name: isEnglish ? '🌐 Language' : '🌐 Langue',
                value: isEnglish ? '🇺🇸 **English**' : '🇫🇷 **Français**',
                inline: true
            },
            {
                name: isEnglish ? '🔔 @Mention Notification' : '🔔 Mention @vous',
                value: notifyMentions ? '✅ **Enabled**' : '❌ **Disabled**',
                inline: true
            },
            {
                name: isEnglish ? '🏆 Rank-up Alerts Only' : '🏆 Alertes Rank-up Seulement',
                value: notifyRankupOnly ? '✅ **Enabled (Promotions only)**' : '❌ **Disabled (All matches)**',
                inline: true
            },
            {
                name: isEnglish ? '🎡 3D Rank Wheel' : '🎡 Roue de Rang 3D',
                value: showRankWheel ? '✅ **Enabled**' : '❌ **Disabled**',
                inline: true
            },
            {
                name: isEnglish ? `👥 Tracked Squad (${followed.length})` : `👥 Joueurs Suivis (${followed.length})`,
                value: trackedListStr,
                inline: false
            }
        )
        .setFooter({ text: 'RadianiteDB • Click buttons below to update settings in real-time' })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_settings_set_current_channel')
            .setLabel(isEnglish ? '📢 Set Current Channel' : '📢 Définir ce salon')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('btn_settings_toggle_mentions')
            .setLabel(notifyMentions ? (isEnglish ? '🔔 Mentions: ON' : '🔔 Mentions : OUI') : (isEnglish ? '🔕 Mentions: OFF' : '🔕 Mentions : NON'))
            .setStyle(notifyMentions ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_settings_toggle_rankup')
            .setLabel(notifyRankupOnly ? (isEnglish ? '🏆 Rankups Only: ON' : '🏆 Rankups Seul : OUI') : (isEnglish ? '🏆 All Matches: ON' : '🏆 Tous Matchs : OUI'))
            .setStyle(notifyRankupOnly ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_settings_toggle_wheel')
            .setLabel(showRankWheel ? (isEnglish ? '🎡 Rank Wheel: ON' : '🎡 Roue RR : OUI') : (isEnglish ? '🎡 Rank Wheel: OFF' : '🎡 Roue RR : NON'))
            .setStyle(showRankWheel ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('btn_settings_switch_lang')
            .setLabel(isEnglish ? '🇫🇷 Passer en Français' : '🇺🇸 Switch to English')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('btn_settings_refresh')
            .setLabel(isEnglish ? '🔄 Refresh' : '🔄 Actualiser')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
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

// History Data Cache Map (key: 'name#tag' -> { matches, mmrHistory, currentMmr, timestamp })
const historyCacheMap = new Map();

function formatLifetimeMatch(m, targetName, targetTag) {
    const meta = m.meta || {};
    const stats = m.stats || {};
    const teams = m.teams || {};
    
    const rawMode = (meta.mode || 'Competitive').toLowerCase();
    const isComp = rawMode.includes('competitive') || rawMode.includes('ranked');
    const isDM = rawMode.includes('deathmatch') && !rawMode.includes('team');
    
    const myTeamKey = (stats.team || 'Blue').toLowerCase();
    const blueScore = teams.blue || 0;
    const redScore = teams.red || 0;
    const myScore = myTeamKey === 'red' ? redScore : blueScore;
    const opponentScore = myTeamKey === 'red' ? blueScore : redScore;
    const hasWon = isDM ? (stats.kills >= 40 || stats.score >= 10000) : (myScore > opponentScore);
    
    const roundsPlayed = (blueScore + redScore) || 1;
    const startedAt = meta.started_at ? Math.floor(new Date(meta.started_at).getTime() / 1000) : Math.floor(Date.now() / 1000);

    return {
        metadata: {
            matchid: meta.id,
            map: meta.map?.name || 'Valorant',
            mode: meta.mode || 'Competitive',
            game_start: startedAt,
            rounds_played: roundsPlayed,
            game_length: roundsPlayed * 105
        },
        teams: {
            blue: { rounds_won: blueScore, rounds_lost: redScore, has_won: blueScore > redScore },
            red: { rounds_won: redScore, rounds_lost: blueScore, has_won: redScore > blueScore },
            [myTeamKey]: { rounds_won: myScore, rounds_lost: opponentScore, has_won: hasWon }
        },
        players: {
            all_players: [
                {
                    name: stats.name || targetName,
                    tag: stats.tag || targetTag,
                    puuid: stats.puuid,
                    character: stats.character?.name || 'Agent',
                    team: myTeamKey === 'red' ? 'Red' : 'Blue',
                    currenttier: stats.tier || 0,
                    stats: {
                        score: stats.score || 0,
                        kills: stats.kills || 0,
                        deaths: stats.deaths || 0,
                        assists: stats.assists || 0,
                        headshots: stats.shots?.head || 0,
                        bodyshots: stats.shots?.body || 0,
                        legshots: stats.shots?.leg || 0
                    },
                    damage_made: stats.damage?.made || 0,
                    damage_received: stats.damage?.received || 0
                }
            ]
        }
    };
}

async function getPlayerHistoryData(name, tag, forceReload = false) {
    const key = `${name.toLowerCase()}#${tag.toLowerCase()}`;
    const now = Date.now();
    if (!forceReload && historyCacheMap.has(key)) {
        const cached = historyCacheMap.get(key);
        if (now - cached.timestamp < 180000) { // 3 minutes cache
            return cached;
        }
    }

    // Determine region
    let region = 'eu';
    try {
        const accRes = await henrikApi.get(`/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`).catch(() => null);
        if (accRes?.data?.data?.region) {
            region = accRes.data.data.region.toLowerCase();
        }
    } catch (e) {}

    // Fetch 50 lifetime matches, v3 matches & MMR history concurrently
    const [lifetimeRes, v3Res, mmrHistRes, mmrV2Res] = await Promise.all([
        henrikApi.get(`/valorant/v1/lifetime/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=50`).catch(() => null),
        henrikApi.get(`/valorant/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=10`).catch(() => null),
        henrikApi.get(`/valorant/v1/mmr-history/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`).catch(() => null),
        henrikApi.get(`/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`).catch(() => null)
    ]);

    const rawLifetime = lifetimeRes?.data?.data || [];
    const rawV3 = v3Res?.data?.data || [];
    const mmrHistory = mmrHistRes?.data?.data || [];
    const currentMmr = mmrV2Res?.data?.data || null;

    // Merge v3 and lifetime matches to get max coverage & detail
    const matchMap = new Map();

    // 1. Add lifetime matches (up to 50 games)
    rawLifetime.forEach(m => {
        if (m.meta?.id) {
            matchMap.set(m.meta.id, formatLifetimeMatch(m, name, tag));
        }
    });

    // 2. Overwrite with full v3 matches where available
    rawV3.forEach(m => {
        if (m.metadata?.matchid) {
            matchMap.set(m.metadata.matchid, m);
        }
    });

    // Sort descending by start time
    const matches = Array.from(matchMap.values()).sort((a, b) => (b.metadata?.game_start || 0) - (a.metadata?.game_start || 0));

    const result = {
        name,
        tag,
        region,
        matches,
        mmrHistory,
        currentMmr,
        timestamp: now
    };

    historyCacheMap.set(key, result);
    return result;
}

function buildHistoryPagePayload(historyData, page = 1, mode = 'competitive', isEn = false) {
    const { name, tag, matches, mmrHistory, currentMmr } = historyData;
    const targetRiotId = `${name}#${tag}`;

    // Filter matches by mode
    const filteredMatches = matches.filter(m => {
        if (!m.metadata) return false;
        const mMode = (m.metadata.mode || m.metadata.queue || '').toLowerCase();
        if (mode === 'all') return true;
        if (mode === 'competitive') return mMode.includes('competitive') || mMode.includes('ranked');
        if (mode === 'deathmatch') return mMode.includes('deathmatch') && !mMode.includes('team');
        if (mode === 'teamdeathmatch') return mMode.includes('teamdeathmatch') || mMode.includes('hurm') || mMode.includes('team_deathmatch');
        if (mode === 'swiftplay') return mMode.includes('swiftplay');
        if (mode === 'unrated') return mMode.includes('unrated');
        return true;
    });

    const pageSize = 5;
    const totalMatches = filteredMatches.length;
    const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIdx = (currentPage - 1) * pageSize;
    const pageMatches = filteredMatches.slice(startIdx, startIdx + pageSize);

    const modeLabels = {
        competitive: isEn ? 'Competitive / Ranked' : 'Compétitif / Classé',
        all: isEn ? 'All Game Modes' : 'Tous les modes',
        deathmatch: isEn ? 'Deathmatch' : 'Match à Mort',
        swiftplay: isEn ? 'Swiftplay' : 'Partie Véloce',
        teamdeathmatch: isEn ? 'Team Deathmatch' : 'Match à Mort par Équipe',
        unrated: isEn ? 'Unrated' : 'Non-classé'
    };
    const activeModeLabel = modeLabels[mode] || mode;

    if (pageMatches.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setTitle(isEn ? `📜 MATCH HISTORY • ${targetRiotId.toUpperCase()}` : `📜 HISTORIQUE DES MATCHS • ${targetRiotId.toUpperCase()}`)
            .setColor(0xff4655)
            .setDescription(
                isEn 
                    ? `⚠️ No **${activeModeLabel}** matches found in the last 20 recorded games for **${targetRiotId}**.\n\n` +
                      `👉 Try running \`/history joueur: ${targetRiotId} mode: all\` to see all game modes.`
                    : `⚠️ Aucun match **${activeModeLabel}** trouvé parmi les 20 dernières parties de **${targetRiotId}**.\n\n` +
                      `👉 Essayez \`/history joueur: ${targetRiotId} mode: all\` pour afficher tous les modes.`
            )
            .setFooter({ text: 'RadianiteDB Telemetry Engine' })
            .setTimestamp();

        return { embeds: [emptyEmbed], components: [] };
    }

    // Compute stats for current 5-match slice
    let sliceWins = 0, sliceLosses = 0;
    let netSliceRR = 0;
    let hasRanked = false;
    let latestTierNum = currentMmr?.current_data?.currenttier || 18;
    let latestTierName = currentMmr?.current_data?.currenttierpatched || (isEn ? 'Unrated' : 'Non-classé');
    let latestRR = currentMmr?.current_data?.ranking_in_tier ?? 50;

    const matchDetailsData = [];

    pageMatches.forEach((m, idx) => {
        const allPlayers = m.players?.all_players || [];
        const p = allPlayers.find(x => x.name?.toLowerCase() === name.toLowerCase() && (!x.tag || x.tag?.toLowerCase() === tag.toLowerCase()))
               || allPlayers.find(x => x.name?.toLowerCase() === name.toLowerCase())
               || allPlayers[0];

        const rawMode = (m.metadata?.mode || m.metadata?.queue || '').toLowerCase();
        const isComp = rawMode.includes('competitive') || rawMode.includes('ranked');
        const isDM = rawMode.includes('deathmatch') && !rawMode.includes('team');

        const team = m.teams?.[p?.team?.toLowerCase()] || { has_won: false, rounds_won: 0, rounds_lost: 0 };
        const hasWon = team.has_won;
        if (hasWon) sliceWins++; else sliceLosses++;

        // Find MMR record matching this match
        const mmrEntry = mmrHistory.find(h => h.match_id === m.metadata?.matchid)
                      || mmrHistory.find(h => Math.abs((h.date_raw || 0) - (m.metadata?.game_start || 0)) < 3600);

        let matchRRChange = 0;
        let matchRankText = '';
        let matchRRText = '';

        if (isComp) {
            hasRanked = true;
            if (mmrEntry) {
                matchRRChange = mmrEntry.mmr_change_to_last_game || 0;
                netSliceRR += matchRRChange;
                matchRankText = mmrEntry.currenttierpatched || 'Ranked';
                matchRRText = `${mmrEntry.ranking_in_tier ?? 0} RR`;
                if (idx === 0 && mmrEntry.currenttier) {
                    latestTierNum = mmrEntry.currenttier;
                    latestTierName = mmrEntry.currenttierpatched;
                    latestRR = mmrEntry.ranking_in_tier ?? latestRR;
                }
            } else if (p?.currenttier_patched) {
                matchRankText = p.currenttier_patched;
            }
        }

        const kills = p?.stats?.kills || 0;
        const deaths = p?.stats?.deaths || 0;
        const assists = p?.stats?.assists || 0;
        const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
        const acs = Math.round((p?.stats?.score || 0) / (m.metadata?.rounds_played || 1));
        const totalShots = (p?.stats?.headshots || 0) + (p?.stats?.bodyshots || 0) + (p?.stats?.legshots || 0);
        const hsPercent = totalShots > 0 ? Math.round(((p?.stats?.headshots || 0) / totalShots) * 100) : 0;
        const damageDelta = (p?.damage_made || 0) - (p?.damage_received || 0);
        const ddSign = damageDelta > 0 ? `+${damageDelta}` : `${damageDelta}`;

        // Deathmatch placement
        let dmPlacement = 1;
        if (isDM) {
            const sortedDM = [...allPlayers].sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0));
            dmPlacement = sortedDM.findIndex(x => x.name?.toLowerCase() === name.toLowerCase()) + 1;
            if (dmPlacement === 0) dmPlacement = 1;
        }

        matchDetailsData.push({
            matchIndex: startIdx + idx,
            matchId: m.metadata?.matchid,
            isComp,
            isDM,
            hasWon,
            teamWon: team.rounds_won,
            teamLost: team.rounds_lost,
            map: m.metadata?.map || 'Valorant',
            character: p?.character || 'Agent',
            gameStart: m.metadata?.game_start || Math.floor(Date.now() / 1000),
            kills, deaths, assists, kd, acs, hsPercent, ddSign,
            matchRRChange, matchRankText, matchRRText,
            dmPlacement, totalPlayers: allPlayers.length || 12
        });
    });

    const winRateSlice = Math.round((sliceWins / pageMatches.length) * 100);
    const netRRString = netSliceRR > 0 ? `+${netSliceRR} RR` : `${netSliceRR} RR`;

    // Dynamic Rank Wheel for this 5-match window
    const rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?rr=${latestRR}&change=${netSliceRR}&tier=${latestTierNum}&size=360&t=${Date.now()}`;

    const mainEmbed = new EmbedBuilder()
        .setTitle(isEn ? `📜 MATCH HISTORY • ${targetRiotId.toUpperCase()}` : `📜 HISTORIQUE DES MATCHS • ${targetRiotId.toUpperCase()}`)
        .setColor(hasRanked ? (netSliceRR >= 0 ? 0x00f5d4 : 0xff4655) : (winRateSlice >= 50 ? 0x00f5d4 : 0xff4655))
        .setDescription(
            `🎮 **Mode :** **${activeModeLabel}** • 📄 **Page ${currentPage}/${totalPages}**\n` +
            `📈 **${isEn ? '5-Match Record' : 'Bilan Page'} :** **${sliceWins}W - ${sliceLosses}L (${winRateSlice}% WR)** ${hasRanked ? `| **${netRRString}**` : ''}\n` +
            `💎 **${isEn ? 'Current Tier' : 'Rang Actuel'} :** **${latestTierName}** (${latestRR} RR)\n` +
            `────────────────────────────────────────`
        )
        .setThumbnail(hasRanked ? rankWheelUrl : 'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png')
        .setFooter({ text: isEn ? `RadianiteDB • Click 'Match 1-5' below to view full Scoreboard & Lobby stats` : `RadianiteDB • Cliquez sur 'Match 1-5' ci-dessous pour ouvrir le Scoreboard complet` })
        .setTimestamp();

    matchDetailsData.forEach((mItem) => {
        const globalNum = mItem.matchIndex + 1;

        if (mItem.isDM) {
            const isTop1 = mItem.dmPlacement === 1;
            mainEmbed.addFields({
                name: `${isTop1 ? '🏆' : '💀'} ${globalNum}. ${isTop1 ? (isEn ? 'VICTORY (TOP 1)' : 'VICTOIRE (TOP 1)') : `TOP ${mItem.dmPlacement}/${mItem.totalPlayers}`} • ${mItem.map} (${mItem.character}) | <t:${mItem.gameStart}:R>`,
                value: `> 🎯 **Score :** **${mItem.kills} Kills / ${mItem.deaths} ${isEn ? 'Deaths' : 'Morts'}** (**${mItem.kd} KD**)\n` +
                       `> 🎯 **Précision :** **${mItem.hsPercent}% Headshot**\n\u200b`,
                inline: false
            });
        } else {
            const icon = mItem.hasWon ? '🟢' : '🔴';
            const resultLabel = mItem.hasWon ? (isEn ? 'VICTORY' : 'VICTOIRE') : (isEn ? 'DEFEAT' : 'DÉFAITE');
            const scoreText = `${mItem.teamWon} - ${mItem.teamLost}`;
            const rankInfo = mItem.isComp && mItem.matchRankText 
                ? `\n> 💎 **${isEn ? 'Rank' : 'Rang'} :** **${mItem.matchRankText}** (${mItem.matchRRText}) • **${mItem.matchRRChange > 0 ? `+${mItem.matchRRChange}` : mItem.matchRRChange} RR**` 
                : '';

            mainEmbed.addFields({
                name: `${icon} ${globalNum}. ${resultLabel} ${scoreText} • ${mItem.map} (${mItem.character}) | <t:${mItem.gameStart}:R>`,
                value: `> ⚔️ **K/D/A :** **${mItem.kills}/${mItem.deaths}/${mItem.assists}** (**${mItem.kd} KD**) • 💥 **ACS :** **${mItem.acs}**\n` +
                       `> 🎯 **Headshot :** **${mItem.hsPercent}%** • 🛡️ **Damage Delta :** **${mItem.ddSign}**` +
                       rankInfo +
                       `\n\u200b`,
                inline: false
            });
        }
    });

    // Row 1: Match Scoreboard Expand Buttons
    const matchButtonsRow = new ActionRowBuilder();
    pageMatches.forEach((m, idx) => {
        const globalNum = startIdx + idx + 1;
        matchButtonsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`hist_det_${encodeURIComponent(name)}_${encodeURIComponent(tag)}_${currentPage}_${startIdx + idx}_${mode}`)
                .setLabel(isEn ? `📊 Match ${globalNum}` : `📊 Match ${globalNum}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔎')
        );
    });

    // Row 2: Pagination & RadianiteDB Link
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`hist_page_${encodeURIComponent(name)}_${encodeURIComponent(tag)}_${currentPage - 1}_${mode}`)
            .setLabel(isEn ? '◀ Previous' : '◀ Précédent')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage <= 1),
        new ButtonBuilder()
            .setCustomId('hist_noop')
            .setLabel(`${currentPage} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`hist_page_${encodeURIComponent(name)}_${encodeURIComponent(tag)}_${currentPage + 1}_${mode}`)
            .setLabel(isEn ? 'Next ▶' : 'Suivant ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages),
        new ButtonBuilder()
            .setLabel('RadianiteDB')
            .setStyle(ButtonStyle.Link)
            .setURL(`${YOUR_WEBSITE_URL}/?player=${encodeURIComponent(name)}%23${encodeURIComponent(tag)}`)
            .setEmoji('🌐')
    );

    return {
        embeds: [mainEmbed],
        components: [matchButtonsRow, navRow]
    };
}

async function buildMatchDetailsPayload(historyData, matchIndex = 0, returnPage = 1, mode = 'competitive', isEn = false) {
    const { name, tag, matches } = historyData;

    // Filter matches to match the list ordering
    const filteredMatches = matches.filter(m => {
        if (!m.metadata) return false;
        const mMode = (m.metadata.mode || m.metadata.queue || '').toLowerCase();
        if (mode === 'all') return true;
        if (mode === 'competitive') return mMode.includes('competitive') || mMode.includes('ranked');
        if (mode === 'deathmatch') return mMode.includes('deathmatch') && !mMode.includes('team');
        if (mode === 'teamdeathmatch') return mMode.includes('teamdeathmatch') || mMode.includes('hurm') || mMode.includes('team_deathmatch');
        if (mode === 'swiftplay') return mMode.includes('swiftplay');
        if (mode === 'unrated') return mMode.includes('unrated');
        return true;
    });

    let match = filteredMatches[matchIndex] || matches[0];
    if (!match) {
        return {
            embeds: [
                new EmbedBuilder()
                    .setTitle(isEn ? '❌ Match not found' : '❌ Match introuvable')
                    .setColor(0xff4655)
                    .setDescription(isEn ? 'Unable to retrieve data for this match.' : 'Impossible de récupérer les données de cette partie.')
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`hist_back_${encodeURIComponent(name)}_${encodeURIComponent(tag)}_${returnPage}_${mode}`)
                        .setLabel(isEn ? '◀ Back to History' : '◀ Retour à l\'historique')
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        };
    }

    // If only basic lifetime match data is present, fetch full 10-player match details
    if ((match.players?.all_players?.length || 0) <= 1 && match.metadata?.matchid) {
        try {
            const singleMatchRes = await henrikApi.get(`/valorant/v2/match/${match.metadata.matchid}`).catch(() => null);
            if (singleMatchRes?.data?.data?.players?.all_players) {
                match = singleMatchRes.data.data;
                filteredMatches[matchIndex] = match;
            }
        } catch (e) {}
    }

    const allPlayers = match.players?.all_players || [];
    const myPlayer = allPlayers.find(x => x.name?.toLowerCase() === name.toLowerCase() && (!x.tag || x.tag?.toLowerCase() === tag.toLowerCase()))
                  || allPlayers.find(x => x.name?.toLowerCase() === name.toLowerCase())
                  || allPlayers[0];

    const isDM = (match.metadata?.mode || match.metadata?.queue || '').toLowerCase().includes('deathmatch') && !(match.metadata?.mode || '').toLowerCase().includes('team');
    const myTeam = match.teams?.[myPlayer?.team?.toLowerCase()] || { has_won: false, rounds_won: 0, rounds_lost: 0 };
    const hasWon = myTeam.has_won;

    const gameDurationMin = Math.round((match.metadata?.game_length || 0) / 60);
    const mapName = match.metadata?.map || 'Valorant';

    // Rank & RR calculation for this specific match
    const mmrHistory = historyData.mmrHistory || [];
    const mmrEntry = mmrHistory.find(h => h.match_id === match.metadata?.matchid)
                  || mmrHistory.find(h => Math.abs((h.date_raw || 0) - (match.metadata?.game_start || 0)) < 3600);

    let rankWheelUrl = null;
    let rankInfoLine = '';
    if (mmrEntry) {
        const change = mmrEntry.mmr_change_to_last_game || 0;
        const rr = mmrEntry.ranking_in_tier ?? 50;
        const tier = mmrEntry.currenttier || 18;
        rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?rr=${rr}&change=${change}&tier=${tier}&size=360&t=${Date.now()}`;
        const changeSign = change >= 0 ? `+${change}` : `${change}`;
        rankInfoLine = `> 💎 **${isEn ? 'Match Rank' : 'Rang du Match'} :** **${mmrEntry.currenttierpatched || 'Ranked'}** (${rr} RR) • **${changeSign} RR** 📈\n`;
    }

    // Find Match MVP (highest score across all players)
    const sortedAll = [...allPlayers].sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
    const matchMvp = sortedAll[0];
    const matchMvpAcs = Math.round((matchMvp?.stats?.score || 0) / (match.metadata?.rounds_played || 1));

    let teamsDescriptionSection = '';

    if (isDM) {
        // Single Deathmatch Leaderboard
        const dmLeaderboardLines = sortedAll.map((p, idx) => {
            const isSelf = p.name?.toLowerCase() === name.toLowerCase();
            const kills = p.stats?.kills || 0;
            const deaths = p.stats?.deaths || 0;
            const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
            const totalShots = (p.stats?.headshots || 0) + (p.stats?.bodyshots || 0) + (p.stats?.legshots || 0);
            const hs = totalShots > 0 ? Math.round(((p.stats?.headshots || 0) / totalShots) * 100) : 0;
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;

            return `${medal} ${isSelf ? `👉 **${p.name}#${p.tag}**` : `**${p.name}#${p.tag}**`} (${p.character})\n` +
                   `> 🎯 **${kills} Kills / ${deaths} Morts** (**${kd} KD**) • **${hs}% HS**\n`;
        });

        const dmTitle = `## 🎯 ${isEn ? `FINAL STANDINGS (${allPlayers.length} PLAYERS)` : `CLASSEMENT FINAL (${allPlayers.length} JOUEURS)`}\n`;
        teamsDescriptionSection = dmTitle + (dmLeaderboardLines.join('\n') || (isEn ? 'No player stats available' : 'Aucune stat disponible'));

    } else {
        // 5v5 Standard Teams (Blue & Red)
        const blueTeamPlayers = allPlayers.filter(p => p.team?.toLowerCase() === 'blue').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
        const redTeamPlayers = allPlayers.filter(p => p.team?.toLowerCase() === 'red').sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));
        const blueTeamObj = match.teams?.blue || { rounds_won: 0, has_won: false };
        const redTeamObj = match.teams?.red || { rounds_won: 0, has_won: false };

        const formatPlayerLine = (p) => {
            const isSelf = p.name?.toLowerCase() === name.toLowerCase();
            const isMvp = p.name?.toLowerCase() === matchMvp?.name?.toLowerCase();
            const kills = p.stats?.kills || 0;
            const deaths = p.stats?.deaths || 0;
            const assists = p.stats?.assists || 0;
            const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills;
            const acs = Math.round((p.stats?.score || 0) / (match.metadata?.rounds_played || 1));
            const totalShots = (p.stats?.headshots || 0) + (p.stats?.bodyshots || 0) + (p.stats?.legshots || 0);
            const hs = totalShots > 0 ? Math.round(((p.stats?.headshots || 0) / totalShots) * 100) : 0;
            const tierStr = p.currenttier_patched ? ` • *${p.currenttier_patched}*` : '';

            const prefix = isSelf ? '👉 ' : '▫️ ';
            const mvpBadge = isMvp ? ' 👑 **(MVP)**' : '';
            return `${prefix}**${p.name}#${p.tag}** (${p.character}${tierStr})${mvpBadge}\n` +
                   `> ⚔️ **${kills} / ${deaths} / ${assists}** (**${kd} KD**) • 💥 **${acs} ACS** • 🎯 **${hs}% HS**\n`;
        };

        const blueLines = blueTeamPlayers.map(formatPlayerLine).join('\n') || (isEn ? 'No players' : 'Aucun joueur');
        const redLines = redTeamPlayers.map(formatPlayerLine).join('\n') || (isEn ? 'No players' : 'Aucun joueur');

        const blueTitle = `## 🔵 ${isEn ? 'BLUE TEAM' : 'ÉQUIPE BLEUE'} — ${blueTeamObj.rounds_won} Rounds ${blueTeamObj.has_won ? '🏆' : ''}\n`;
        const redTitle = `## 🔴 ${isEn ? 'RED TEAM' : 'ÉQUIPE ROUGE'} — ${redTeamObj.rounds_won} Rounds ${redTeamObj.has_won ? '🏆' : ''}\n`;

        teamsDescriptionSection = `${blueTitle}${blueLines}\n${redTitle}${redLines}`;
    }

    const headerSection = isDM
        ? `🎮 **Mode :** Match à Mort (Deathmatch) • ⏱️ **Durée :** ${gameDurationMin} min\n` +
          `🕒 **Date :** <t:${match.metadata?.game_start}:f> (<t:${match.metadata?.game_start}:R>)\n\n` +
          `⭐ **Match MVP :** **${matchMvp?.name}#${matchMvp?.tag}** (${matchMvp?.character} • **${matchMvpAcs} ACS**)\n` +
          `────────────────────────────────────────\n\n`
        : `🏆 **Résultat :** **${hasWon ? (isEn ? 'VICTORY' : 'VICTOIRE') : (isEn ? 'DEFEAT' : 'DÉFAITE')}** (${myTeam.rounds_won} - ${myTeam.rounds_lost})\n` +
          `⏱️ **Durée :** ${gameDurationMin} min • **Rounds joués :** ${match.metadata?.rounds_played || 0}\n` +
          `🕒 **Date :** <t:${match.metadata?.game_start}:f> (<t:${match.metadata?.game_start}:R>)\n` +
          rankInfoLine +
          `⭐ **Match MVP :** **${matchMvp?.name}#${matchMvp?.tag}** (${matchMvp?.character} • **${matchMvpAcs} ACS**)\n` +
          `────────────────────────────────────────\n\n`;

    const scoreboardEmbed = new EmbedBuilder()
        .setTitle(
            isEn 
                ? `📊 MATCH SCOREBOARD • ${mapName.toUpperCase()} (${match.metadata?.mode || 'Game'})`
                : `📊 SCOREBOARD DU MATCH • ${mapName.toUpperCase()} (${match.metadata?.mode || 'Partie'})`
        )
        .setColor(isDM ? 0xffb703 : (hasWon ? 0x00f5d4 : 0xff4655))
        .setDescription(headerSection + teamsDescriptionSection)
        .setThumbnail(rankWheelUrl || myPlayer?.assets?.agent?.small || 'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png')
        .setFooter({ text: isEn ? `RadianiteDB Scoreboard Intelligence • Match #${matchIndex + 1}` : `RadianiteDB Scoreboard • Match #${matchIndex + 1}` })
        .setTimestamp(new Date((match.metadata?.game_start || 0) * 1000));

    const backButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`hist_back_${encodeURIComponent(name)}_${encodeURIComponent(tag)}_${returnPage}_${mode}`)
            .setLabel(isEn ? `◀ Back to History (Page ${returnPage})` : `◀ Retour à l'historique (Page ${returnPage})`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📜'),
        new ButtonBuilder()
            .setLabel(isEn ? 'View on RadianiteDB' : 'Voir sur RadianiteDB')
            .setStyle(ButtonStyle.Link)
            .setURL(`${YOUR_WEBSITE_URL}/?player=${encodeURIComponent(name)}%23${encodeURIComponent(tag)}`)
            .setEmoji('🌐')
    );

    return {
        embeds: [scoreboardEmbed],
        components: [backButtonRow]
    };
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

    // 🔘 Handle Match History Pagination & Detail Buttons
    if (interaction.isButton()) {
        if (interaction.customId === 'hist_noop') {
            await interaction.deferUpdate().catch(() => {});
            return;
        }

        if (interaction.customId.startsWith('hist_page_')) {
            await interaction.deferUpdate().catch(() => {});
            const isEn = (await getUserLang(interaction.user.id)) === 'en';
            const parts = interaction.customId.split('_');
            const encName = parts[2];
            const encTag = parts[3];
            const targetPage = parseInt(parts[4]) || 1;
            const mode = parts[5] || 'competitive';
            const name = decodeURIComponent(encName);
            const tag = decodeURIComponent(encTag);

            try {
                const historyData = await getPlayerHistoryData(name, tag, false);
                const payload = buildHistoryPagePayload(historyData, targetPage, mode, isEn);
                await interaction.editReply(payload);
            } catch (err) {
                console.error('[RadianiteBot] Error updating history page:', err);
            }
            return;
        }

        if (interaction.customId.startsWith('hist_det_')) {
            await interaction.deferUpdate().catch(() => {});
            const isEn = (await getUserLang(interaction.user.id)) === 'en';
            const parts = interaction.customId.split('_');
            const encName = parts[2];
            const encTag = parts[3];
            const returnPage = parseInt(parts[4]) || 1;
            const matchIndex = parseInt(parts[5]) || 0;
            const mode = parts[6] || 'competitive';
            const name = decodeURIComponent(encName);
            const tag = decodeURIComponent(encTag);

            try {
                const historyData = await getPlayerHistoryData(name, tag, false);
                const payload = await buildMatchDetailsPayload(historyData, matchIndex, returnPage, mode, isEn);
                await interaction.editReply(payload);
            } catch (err) {
                console.error('[RadianiteBot] Error showing match details:', err);
            }
            return;
        }

        if (interaction.customId.startsWith('hist_back_')) {
            await interaction.deferUpdate().catch(() => {});
            const isEn = (await getUserLang(interaction.user.id)) === 'en';
            const parts = interaction.customId.split('_');
            const encName = parts[2];
            const encTag = parts[3];
            const returnPage = parseInt(parts[4]) || 1;
            const mode = parts[5] || 'competitive';
            const name = decodeURIComponent(encName);
            const tag = decodeURIComponent(encTag);

            try {
                const historyData = await getPlayerHistoryData(name, tag, false);
                const payload = buildHistoryPagePayload(historyData, returnPage, mode, isEn);
                await interaction.editReply(payload);
            } catch (err) {
                console.error('[RadianiteBot] Error returning to history page:', err);
            }
            return;
        }

        if (interaction.customId.startsWith('setlang_')) {
            const chosenLang = interaction.customId.replace('setlang_', '');
            if (interaction.guildId) {
                await knex('guild_configs').insert({
                    guild_id: interaction.guildId,
                    guild_name: interaction.guild?.name || 'Discord Server',
                    language: chosenLang
                });
            }
            await knex('users').where({ discord_id: interaction.user.id }).update({ language: chosenLang }).catch(() => {});
            const msgs = {
                en: '🇺🇸 **Language set to English!** Type `/help` to see all commands.',
                fr: '🇫🇷 **Langue définie sur Français !** Tapez `/help` pour voir toutes les commandes.',
                es: '🇪🇸 **¡Idioma establecido en Español!** Escribe `/help` para ver los comandos.',
                de: '🇩🇪 **Sprache auf Deutsch eingestellt!** Tippe `/help` für alle Befehle.'
            };
            return interaction.reply({ content: msgs[chosenLang] || msgs.en, ephemeral: true });
        }

        // ⚙️ Interactive Settings Buttons Handlers
        if (interaction.customId.startsWith('btn_settings_')) {
            await interaction.deferUpdate().catch(() => {});
            const isEn = (await getUserLang(interaction.user.id)) === 'en';
            let user = await knex('users').where({ discord_id: interaction.user.id }).first();
            if (!user) {
                await knex('users').insert({
                    discord_id: interaction.user.id,
                    username: interaction.user.username,
                    avatar: interaction.user.displayAvatarURL(),
                    language: isEn ? 'en' : 'fr'
                });
                user = await knex('users').where({ discord_id: interaction.user.id }).first();
            }

            if (interaction.customId === 'btn_settings_set_current_channel') {
                await knex('users').where({ discord_id: interaction.user.id }).update({ discord_channel_id: interaction.channelId });
                if (interaction.guildId) {
                    await knex('guild_configs').where({ guild_id: interaction.guildId }).update({ channel_id: interaction.channelId }).catch(() => {});
                }
            } else if (interaction.customId === 'btn_settings_toggle_mentions') {
                const currentVal = user.notify_mentions !== false;
                await knex('users').where({ discord_id: interaction.user.id }).update({ notify_mentions: !currentVal });
            } else if (interaction.customId === 'btn_settings_toggle_rankup') {
                const currentVal = Boolean(user.notify_rankup_only);
                await knex('users').where({ discord_id: interaction.user.id }).update({ notify_rankup_only: !currentVal });
            } else if (interaction.customId === 'btn_settings_toggle_wheel') {
                const currentVal = user.show_rank_wheel !== false;
                await knex('users').where({ discord_id: interaction.user.id }).update({ show_rank_wheel: !currentVal });
            } else if (interaction.customId === 'btn_settings_switch_lang') {
                const currentLang = user.language === 'en' ? 'en' : 'fr';
                const nextLang = currentLang === 'en' ? 'fr' : 'en';
                await knex('users').where({ discord_id: interaction.user.id }).update({ language: nextLang });
                if (interaction.guildId) {
                    await knex('guild_configs').where({ guild_id: interaction.guildId }).update({ language: nextLang }).catch(() => {});
                }
            }

            const updatedPayload = await renderSettingsPayload(interaction.user.id, interaction.guildId, isEn);
            await interaction.editReply(updatedPayload).catch(() => {});
            return;
        }
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
    incrementBotStat(`cmd_${commandName}`);
    incrementBotStat('total_commands');

    // 0. /settings Command
    if (commandName === 'settings' || commandName === 'config') {
        await interaction.deferReply({ ephemeral: true });
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const payload = await renderSettingsPayload(interaction.user.id, interaction.guildId, isEn);
        return interaction.editReply(payload);
    }

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
                : `✅ **Authentification 2FA validée !**\n👤 **Joueur :** **${result.session.username}**\n\n👉 Tapez **/store** pour consulter votre boutique du jour !`
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

    // 4. /store, /shop, /boutique Commands
    if (commandName === 'store' || commandName === 'shop' || commandName === 'boutique') {
        const tokenArg = interaction.options.getString('link_or_token') || interaction.options.getString('lien_ou_token');
        await handleStoreInteraction(interaction, tokenArg);
    }

    // 5. /setchannel Command
    if (commandName === 'setchannel') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const discord_id = interaction.user.id;
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const channel_id = targetChannel.id;

        try {
            if (interaction.guildId) {
                await knex('guild_configs').insert({
                    guild_id: interaction.guildId,
                    guild_name: interaction.guild?.name || 'Discord Server',
                    channel_id: channel_id
                });
            }
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
                    ? `✅ **Alerts channel configured!** Match notifications for your tracked players will be sent in <#${channel_id}>.`
                    : `✅ **Salon configuré !** Les notifications de match pour vos joueurs suivis seront envoyées dans <#${channel_id}>.`,
                ephemeral: true 
            });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: isEn ? 'An error occurred while configuring channel.' : 'Une erreur est survenue lors de la configuration du salon.', ephemeral: true });
        }
    }

    // 6. /wishlist Command (Subcommands: add, remove, list / ajouter, retirer, liste)
    if (commandName === 'wishlist') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const sub = interaction.options.getSubcommand();

        if (sub === 'add' || sub === 'ajouter') {
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

        if (sub === 'remove' || sub === 'retirer') {
            await interaction.deferReply({ ephemeral: true });
            const skinName = interaction.options.getString('skin');
            await knex('wishlist').where({ discord_id: interaction.user.id, skin_name: skinName }).del();

            return interaction.editReply({
                content: isEn 
                    ? `🗑️ **${skinName}** has been removed from your wishlist.`
                    : `🗑️ Le skin **${skinName}** a été retiré de votre liste de surveillance.`
            });
        }

        if (sub === 'list' || sub === 'liste') {
            await interaction.deferReply({ ephemeral: true });
            const userWishes = await knex('wishlist').where({ discord_id: interaction.user.id }).select();

            if (userWishes.length === 0) {
                return interaction.editReply({
                    content: isEn
                        ? `📋 **Your wishlist is empty.**\nUse **/wishlist add skin: ...** to track skins and receive automatic DM alerts!`
                        : `📋 **Votre wishlist est vide.**\nUtilisez **/wishlist add skin: ...** pour ajouter vos skins de rêve et recevoir une alerte automatique !`
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

    // 7. /leaderboard Command
    if (commandName === 'leaderboard' || commandName === 'classement') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';

        try {
            const followed = (await knex('followed_players').select()) || [];
            const users = (await knex('users').select()) || [];
            
            const candidateIds = new Set(followed.map(f => f.riot_id).filter(Boolean));
            users.forEach(u => {
                if (u.riot_auth) {
                    const s = decryptData(u.riot_auth);
                    if (s?.username && s.username.includes('#')) candidateIds.add(s.username);
                }
            });

            if (candidateIds.size === 0) {
                return interaction.editReply({
                    content: isEn 
                        ? `ℹ️ **No players followed on this server.** Use **/follow player: Player#TAG** to add players to the leaderboard!` 
                        : `ℹ️ **Aucun joueur suivi sur ce serveur.** Utilisez **/follow player: Pseudo#TAG** pour ajouter des joueurs au classement !`
                });
            }

            const leaderboardList = [];
            for (const rId of candidateIds) {
                const [n, t] = rId.split('#');
                if (!n || !t) continue;
                try {
                    const data = await getPlayerHistoryData(n.trim(), t.trim(), false);
                    if (data?.current_tier_patched) {
                        const rr = data.current_tier_ranking || 0;
                        const tierNum = data.current_tier || 0;
                        leaderboardList.push({
                            riotId: rId,
                            tierName: data.current_tier_patched,
                            tierNum,
                            rr,
                            elo: tierNum * 100 + rr
                        });
                    }
                } catch (e) {}
                await sleep(200);
            }

            if (leaderboardList.length === 0) {
                return interaction.editReply({ content: isEn ? `ℹ️ Could not calculate leaderboard.` : `ℹ️ Impossible de calculer le classement.` });
            }

            leaderboardList.sort((a, b) => b.elo - a.elo);
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            const lbEmbed = new EmbedBuilder()
                .setTitle(isEn ? `🏆 SERVER SQUAD LEADERBOARD` : `🏆 CLASSEMENT COMPÉTITIF DU SERVEUR`)
                .setColor(0xffb703)
                .setDescription(
                    (isEn ? `Followed squad players ranked by **Tier & RR** :\n\n` : `Joueurs suivis du serveur classés par **Rang & RR** :\n\n`) +
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
            console.error('[RadianiteBot] Error /leaderboard:', err);
            return interaction.editReply({ content: isEn ? `❌ Error calculating leaderboard.` : `❌ Erreur lors du calcul du classement.` });
        }
    }

    // 9. /session Command
    if (commandName === 'session') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        let targetRiotId = interaction.options.getString('player') || interaction.options.getString('joueur');

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
                content: isEn ? `❌ **Please specify a player :** \`/session player: Player#TAG\`` : `❌ **Veuillez préciser un joueur :** \`/session player: Pseudo#TAG\``
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

    // 10. /follow Command
    if (commandName === 'follow') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const playerArg = interaction.options.getString('player') || interaction.options.getString('joueur');
        if (!playerArg || !playerArg.includes('#')) {
            return interaction.reply({
                content: isEn ? `❌ **Please specify a valid Riot ID :** \`/follow player: Player#TAG\`` : `❌ **Veuillez préciser un identifiant valide :** \`/follow player: Pseudo#TAG\``,
                ephemeral: true
            });
        }
        
        let user = await knex('users').where({ discord_id: interaction.user.id }).first();
        if (!user) {
            await knex('users').insert({
                discord_id: interaction.user.id,
                username: interaction.user.username,
                avatar: interaction.user.displayAvatarURL(),
                discord_channel_id: interaction.channel.id
            });
            user = await knex('users').where({ discord_id: interaction.user.id }).first();
        } else if (!user.discord_channel_id) {
            await knex('users').where({ discord_id: interaction.user.id }).update({ discord_channel_id: interaction.channel.id });
        }

        const existing = await knex('followed_players').where({ user_id: user.id, riot_id: playerArg.trim() }).first();
        if (!existing) {
            await knex('followed_players').insert({
                user_id: user.id,
                guild_id: interaction.guildId || null,
                riot_id: playerArg.trim()
            });
        }

        return interaction.reply({
            content: isEn
                ? `✅ **Now following ${playerArg.trim()}!** Match summaries will automatically be posted in <#${interaction.channel.id}>.`
                : `✅ **Joueur ${playerArg.trim()} désormais suivi !** Les résumés de match seront automatiquement envoyés dans <#${interaction.channel.id}>.`,
            ephemeral: true
        });
    }

    // 11. /unfollow Command
    if (commandName === 'unfollow') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const playerArg = interaction.options.getString('player') || interaction.options.getString('joueur');
        if (!playerArg) {
            return interaction.reply({ content: isEn ? `❌ **Please specify a player to unfollow.**` : `❌ **Veuillez préciser un joueur.**`, ephemeral: true });
        }
        const user = await knex('users').where({ discord_id: interaction.user.id }).first();
        if (user) {
            await knex('followed_players').where({ user_id: user.id, riot_id: playerArg.trim() }).del();
        }
        return interaction.reply({
            content: isEn ? `🗑️ **Unfollowed ${playerArg.trim()}.**` : `🗑️ **Joueur ${playerArg.trim()} retiré du suivi.**`,
            ephemeral: true
        });
    }

    // 12. /help Command
    if (commandName === 'help') {
        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        const helpEmbed = new EmbedBuilder()
            .setTitle(isEn ? '⚡ RADIANITEBOT // COMMANDS & FEATURES' : '⚡ RADIANITEBOT // COMMANDES & FONCTIONNALITÉS')
            .setColor(0x00f5d4)
            .setDescription(
                isEn
                    ? `**Official Valorant telemetry, store radar and match analysis.**\n\n` +
                      `⚙️ **/settings** • Interactive control panel: alert channel, @mentions, rank-up filters & language.\n` +
                      `📊 **/history [player] [mode]** • 50+ Match history, 5-game net RR Wheel, and interactive scoreboards.\n` +
                      `🛒 **/store** • Live 24h rotating skin shop and wallet balances.\n` +
                      `📈 **/session [player]** • Past 24h match performance recap, net RR win/loss and K/D.\n` +
                      `🏆 **/leaderboard** • Server competitive squad standings.\n` +
                      `👥 **/follow [player]** • Follow players to get automated channel alerts upon match end.\n` +
                      `🗑️ **/unfollow [player]** • Stop following a player.\n` +
                      `🔔 **/setchannel [channel]** • Set target channel for automated match alerts.\n` +
                      `⭐ **/wishlist** • Track skins for instant private DM alerts.\n` +
                      `🌐 **/language** • Change bot language.`
                    : `**Télémétrie Valorant officielle, radar de boutique et analyse de parties.**\n\n` +
                      `⚙️ **/settings** • Panneau de configuration interactif : salon, mentions @vous, filtres rankup & langue.\n` +
                      `📊 **/history [joueur] [mode]** • Historique 50+ matchs, roue RR 5 parties et scoreboards complets.\n` +
                      `🛒 **/store** • Boutique du jour 24h en direct et soldes VP/KC.\n` +
                      `📈 **/session [joueur]** • Rapport de performance des dernières 24h avec gain/perte net de RR.\n` +
                      `🏆 **/leaderboard** • Classement compétitif des membres du serveur.\n` +
                      `👥 **/follow [joueur]** • Suivre un joueur pour recevoir des alertes automatiques en fin de partie.\n` +
                      `🗑️ **/unfollow [joueur]** • Arrêter de suivre un joueur.\n` +
                      `🔔 **/setchannel [salon]** • Définir le salon des alertes automatiques.\n` +
                      `⭐ **/wishlist** • Ajouter des skins pour recevoir des alertes en MP.\n` +
                      `🌐 **/language** • Changer la langue du bot.`
            )
            .setFooter({ text: 'RadianiteDB Protocol • https://radianitedb.lol' })
            .setTimestamp();
        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    // 13. /language Command
    if (commandName === 'language' || commandName === 'langue') {
        const chosenLang = interaction.options.getString('lang') || interaction.options.getString('langue') || 'en';
        const discord_id = interaction.user.id;

        try {
            if (interaction.guildId) {
                await knex('guild_configs').insert({
                    guild_id: interaction.guildId,
                    guild_name: interaction.guild?.name || 'Discord Server',
                    language: chosenLang
                });
            }
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

            const msgs = {
                en: '🇺🇸 **Language set to English!** Your match alerts and channel notifications will now be sent in English.',
                fr: '🇫🇷 **Langue définie sur Français !** Vos alertes de match et notifications de salon seront envoyées en français.',
                es: '🇪🇸 **¡Idioma establecido en Español!** Las alertas se enviarán en español.',
                de: '🇩🇪 **Sprache auf Deutsch eingestellt!** Benachrichtigungen werden auf Deutsch gesendet.'
            };
            return interaction.reply({ content: msgs[chosenLang] || msgs.en, ephemeral: true });
        } catch (err) {
            console.error('[RadianiteBot] Erreur /language:', err);
            return interaction.reply({ content: 'Une erreur est survenue lors de la configuration de la langue.', ephemeral: true });
        }
    }

    // 14. /history Command
    if (commandName === 'history' || commandName === 'historique') {
        await interaction.deferReply({ ephemeral: false });

        const isEn = (await getUserLang(interaction.user.id)) === 'en';
        let targetRiotId = interaction.options.getString('player') || interaction.options.getString('joueur');
        const mode = interaction.options.getString('mode') || 'competitive';

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
                content: isEn 
                    ? `❌ **Please specify a full Riot ID :** \`/history player: Player#TAG\` (e.g. \`TenZ#SEN\`)` 
                    : `❌ **Veuillez préciser un identifiant Riot complet :** \`/history player: Pseudo#TAG\` (ex: \`TenZ#SEN\`)`
            });
        }

        const [name, tag] = targetRiotId.split('#');
        if (!name || !tag) {
            return interaction.editReply({
                content: isEn 
                    ? `❌ **Invalid format.** Please use \`Pseudo#TAG\` (e.g. \`JL Pa1ze#TTV\`).`
                    : `❌ **Format invalide.** Veuillez utiliser la forme \`Pseudo#TAG\` (ex: \`JL Pa1ze#TTV\`).`
            });
        }

        try {
            const historyData = await getPlayerHistoryData(name.trim(), tag.trim(), false);
            if (!historyData.matches || historyData.matches.length === 0) {
                return interaction.editReply({
                    content: isEn 
                        ? `ℹ️ **No matches found for ${targetRiotId}.** Check that the Riot ID is correct.`
                        : `ℹ️ **Aucun match trouvé pour ${targetRiotId}.** Vérifiez l'orthographe du Pseudo et du TAG.`
                });
            }

            const payload = buildHistoryPagePayload(historyData, 1, mode, isEn);
            return interaction.editReply(payload);

        } catch (err) {
            console.error('[RadianiteBot] Error executing /history:', err);
            return interaction.editReply({
                content: isEn 
                    ? `❌ An error occurred while retrieving match history: ${err.message}` 
                    : `❌ Une erreur est survenue lors de la récupération de l'historique : ${err.message}`
            });
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

                    const badges = [];
                    if (kills >= 30) badges.push('🔥 30+ BOMB');
                    if (hsPercent >= 40 && kills >= 15) badges.push('🎯 HEADSHOT DEMON');
                    if (kd >= 2.5 && kills >= 15) badges.push('👑 UNTOUCHABLE');
                    if (String(pData.rrChange || '').includes('Ranked Up') || String(pData.rrChange || '').includes('Promoted')) badges.push('🏆 TIER RANKUP');
                    const badgeText = badges.length > 0 ? `\n🏅 **Highlights :** ${badges.join(' • ')}` : '';

                    if (pData.isDeathmatch) {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character}) • ${pData.isDmWin ? (isEn ? '🏆 Top 1 (Victory)' : '🏆 Top 1 (Victoire)') : `Top ${pData.placement}/${match.players?.all_players?.length || 12}`}`,
                            value: `🎯 **Score :** **${kills} Kills / ${deaths} ${isEn ? 'Deaths' : 'Morts'}** (${kd} KD)\n` +
                                   `💥 **Assists :** ${assists} | 🎯 **${isEn ? 'Headshots' : 'Tirs Tête'} :** ${p.stats?.headshots || 0} (${hsPercent}%)${badgeText}\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else if (pData.isCompetitive) {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **${isEn ? 'Headshot %' : 'Tirs Tête'} :** ${hsPercent}%\n` +
                                   `📈 **${isEn ? 'RR Change' : 'Évolution RR'} :** **${pData.rrChange || '±0 RR'}**${badgeText}\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else {
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **${isEn ? 'Headshot %' : 'Tirs Tête'} :** ${hsPercent}%${badgeText}\n` +
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

                // Build Action Buttons linking to each player's profile on RadianiteDB
                const actionComponents = [];
                const buttonRow = new ActionRowBuilder();

                squadPlayers.slice(0, 5).forEach(pData => {
                    const [pName, pTag] = (pData.riotId || '').split('#');
                    const profileUrl = `${YOUR_WEBSITE_URL}/?player=${encodeURIComponent(pName || '')}%23${encodeURIComponent(pTag || '')}`;
                    
                    buttonRow.addComponents(
                        new ButtonBuilder()
                            .setLabel(squadPlayers.length === 1 ? 'Voir le Profil' : `${pName}`)
                            .setStyle(ButtonStyle.Link)
                            .setURL(profileUrl)
                            .setEmoji('📊')
                    );
                });

                if (buttonRow.components.length > 0) {
                    actionComponents.push(buttonRow);
                }

                const mentionPrefix = userData.notifyMentions ? `<@${userData.user}>, ` : '';
                const matchMsg = isEn 
                    ? `${mentionPrefix}${isSquad ? `your tracked players in **${squadTitle}** finished their match (${modeDisplay})!` : `**${first.riotId}** finished their match (${modeDisplay})!`}`
                    : `${mentionPrefix}${isSquad ? `vos joueurs suivis en **${squadTitle}** ont terminé leur partie (${modeDisplay}) !` : `**${first.riotId}** a terminé sa partie (${modeDisplay}) !`}`;

                await channel.send({
                    content: matchMsg,
                    embeds: finalEmbeds,
                    components: actionComponents
                });
                incrementBotStat('match_notifications_sent');

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
