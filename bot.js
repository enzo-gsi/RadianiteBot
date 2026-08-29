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
    }
];

// Register Slash Commands Instantly (Global + All Connected Guilds)
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function registerSlashCommands() {
    try {
        console.log('[RadianiteBot] Enregistrement des commandes Slash globales...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log('[RadianiteBot] Commandes globales enregistrées.');

        // Also register directly on each guild to bypass Discord CDN propagation delay!
        const guilds = await client.guilds.fetch();
        for (const [guildId] of guilds) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, guildId),
                    { body: commands }
                );
                console.log(`[RadianiteBot] Commandes enregistrées instantanément sur le serveur ${guildId}.`);
            } catch (gErr) {
                console.warn(`[RadianiteBot] Notice enregistrement guild ${guildId}:`, gErr.message);
            }
        }
    } catch (error) {
        console.error('[RadianiteBot] Erreur enregistrement commandes:', error);
    }
}

client.once('ready', async () => {
    console.log(`[RadianiteBot] Connecté en tant que ${client.user.tag} !`);
    await refreshValorantData();
    await registerSlashCommands();
});

// Auto-register on new guild join
client.on('guildCreate', async guild => {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id),
            { body: commands }
        );
    } catch (e) {}
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
                    content: `❌ **Le lien ou jeton Riot fourni est invalide ou a expiré.**\nVeuillez vous reconnecter via les boutons ci-dessous.`,
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
            .setTitle('🛒 BOUTIQUE VALORANT • CONNEXION REQUISE')
            .setColor(0x00f5d4)
            .setDescription(
                `Pour afficher votre boutique du jour en direct, liez votre compte Riot au bot (session persistante chiffrée AES-256).\n\n` +
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
            const item = valorantSkinLevelMap[uuid] || valorantWeaponMap[uuid] || { displayName: 'Skin d\'arme' };
            const exactPrice = priceMap[uuid] || 1775;
            return { ...item, exactPrice };
        });

        const resetDuration = storeData.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 86400;
        const resetTimestamp = Math.floor(Date.now() / 1000) + resetDuration;

        const allEmbeds = [];

        // 1. Header Embed with Balances & Rotation Countdown
        const headerEmbed = new EmbedBuilder()
            .setTitle(`🛒 BOUTIQUE DU JOUR • ${username.toUpperCase()}`)
            .setColor(0x00f5d4)
            .setDescription(
                `💰 **Vos Soldes :** **${vp} VP** | **${rad} RP** | **${kc} KC**\n` +
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
                .setDescription(`💵 **Prix :** **${offer.exactPrice.toLocaleString()} VP**`);

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
                .setTitle(`📦 Pack en Vedette : ${bInfo.displayName || 'Collection Spéciale'}`)
                .setDescription(`✨ Disponible pour un temps limité • [Consulter sur RadianiteDB](${YOUR_WEBSITE_URL}/#store)`);
            if (bInfo.displayIcon2 || bInfo.displayIcon) {
                bundleEmbed.setImage(bInfo.displayIcon2 || bInfo.displayIcon);
            }
            allEmbeds.push(bundleEmbed);
        }

        // 4. Night Market Notice (if active)
        if (storeData.BonusStore?.BonusStoreOffers) {
            const nmEmbed = new EmbedBuilder()
                .setColor(0x7209b7)
                .setTitle(`🌙 Marché Nocturne Détecté !`)
                .setDescription(`👉 **${storeData.BonusStore.BonusStoreOffers.length} offres à prix réduit** disponibles sur votre compte ! Rendez-vous sur **${YOUR_WEBSITE_URL}/#store** pour les inspecter.`);
            allEmbeds.push(nmEmbed);
        }

        const finalEmbeds = allEmbeds.slice(0, 10);
        await interaction.editReply({ embeds: finalEmbeds });

    } catch (err) {
        console.error("[RadianiteBot] Erreur chargement boutique:", err.response?.data || err.message);
        await interaction.editReply({
            content: `❌ **Impossible de charger votre boutique Valorant.**\nVotre session a expiré ou Riot bloque l'accès temporairement. Veuillez renouveler votre connexion ci-dessous.`,
            components: [createLoginActionRow()]
        });
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

        const username = interaction.options.getString('identifiant');
        const password = interaction.options.getString('mot_de_passe');
        const linkArg = interaction.options.getString('lien');

        // Case A: Link Provided directly in command
        if (linkArg) {
            const extracted = extractTokensFromUri(linkArg);
            if (!extracted.accessToken) {
                return interaction.editReply({
                    content: `❌ **Le lien fourni est invalide.**\nAssurez-vous qu'il contient \`access_token=...\` et provient bien de Riot Games.`
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
                    content: `✅ **Compte Riot lié avec succès !**\n` +
                             `👤 **Joueur :** **${sessionData.username}**\n` +
                             `🌐 **Région :** ${sessionData.shard.toUpperCase()}\n\n` +
                             `👉 Tapez **/boutique** ou **/store** pour consulter vos 4 skins du jour et vos soldes !`
                });
            } catch (err) {
                return interaction.editReply({
                    content: `❌ Impossible de valider le jeton Riot : ${err.message}`
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
                        content: `🔐 **Code 2FA Requis !**\nUn code de sécurité a été envoyé à **${result.email}**.\n👉 Tapez **/2fa code: 123456** pour finaliser votre connexion.`
                    });
                }

                if (!result.success) {
                    return interaction.editReply({
                        content: `❌ **Échec de connexion directe :** ${result.error}\n\n👉 **Conseil :** Utilisez le bouton ci-dessous pour vous connecter en 1-clic via la page officielle Riot Games :`,
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
                    content: `✅ **Compte Riot connecté avec succès !**\n` +
                             `👤 **Joueur :** **${result.session.username}**\n` +
                             `🌐 **Région :** ${result.session.shard.toUpperCase()}\n\n` +
                             `🔒 *Votre session est chiffrée (AES-256) et reste persistante.*\n` +
                             `👉 Tapez **/boutique** ou **/store** à tout moment pour voir vos skins du jour !`
                });

            } catch (err) {
                console.error('[RadianiteBot] Erreur /login:', err);
                return interaction.editReply({
                    content: `❌ Une erreur inattendue est survenue. Veuillez utiliser la méthode 1-clic ci-dessous :`,
                    components: [createLoginActionRow()]
                });
            }
        }

        // Case C: Neither provided -> Display Interactive Action Row with Buttons
        const loginEmbed = new EmbedBuilder()
            .setTitle('🔐 CONNEXION COMPTE RIOT GAMES')
            .setColor(0x00f5d4)
            .setDescription(
                `Connectez votre compte pour accéder à votre boutique quotidienne Valorant en direct !\n\n` +
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

        const pending = pending2FAMap.get(interaction.user.id);
        if (!pending || Date.now() > pending.expiresAt) {
            pending2FAMap.delete(interaction.user.id);
            return interaction.editReply({
                content: `⚠️ **Aucune demande 2FA en attente ou le code a expiré.**\nVeuillez relancer la commande **/login**.`
            });
        }

        const code = interaction.options.getString('code');
        const result = await submit2FACode(code, pending.cookies);
        pending2FAMap.delete(interaction.user.id);

        if (!result.success) {
            return interaction.editReply({
                content: `❌ **${result.error || 'Code 2FA invalide.'}**\nVeuillez relancer **/login** si nécessaire.`
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
            content: `✅ **Authentification 2FA validée !**\n` +
                     `👤 **Joueur :** **${result.session.username}**\n\n` +
                     `👉 Tapez **/boutique** ou **/store** pour consulter votre boutique du jour !`
        });
    }

    // 3. /unlink Command
    if (commandName === 'unlink') {
        await knex('users').where({ discord_id: interaction.user.id }).update({ riot_auth: null });
        pending2FAMap.delete(interaction.user.id);
        return interaction.reply({
            content: `🗑️ **Votre compte et session Riot ont été totalement supprimés du bot.**`,
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
                content: `✅ **Salon configuré !** Les notifications de match pour vos joueurs suivis seront envoyées dans **#${interaction.channel.name}**.`,
                ephemeral: true 
            });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'Une erreur est survenue lors de la configuration du salon.', ephemeral: true });
        }
    }

    // 6. /wishlist Command (Subcommands: ajouter, retirer, liste)
    if (commandName === 'wishlist') {
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
                .setTitle('⭐ SKIN AJOUTÉ À VOTRE WISHLIST !')
                .setColor(0x00f5d4)
                .setDescription(
                    `✨ **${finalName}** est désormais sous surveillance !\n\n` +
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
                content: `🗑️ Le skin **${skinName}** a été retiré de votre liste de surveillance.`
            });
        }

        if (sub === 'liste') {
            await interaction.deferReply({ ephemeral: true });
            const userWishes = await knex('wishlist').where({ discord_id: interaction.user.id }).select();

            if (userWishes.length === 0) {
                return interaction.editReply({
                    content: `📋 **Votre wishlist est vide.**\nUtilisez **/wishlist ajouter skin: ...** pour ajouter vos skins de rêve et recevoir une alerte automatique !`
                });
            }

            const listEmbed = new EmbedBuilder()
                .setTitle(`⭐ VOS SKINS SURVEILLÉS (${userWishes.length})`)
                .setColor(0x00f5d4)
                .setDescription(
                    userWishes.map((w, i) => `**${i + 1}.** ${w.skin_name}`).join('\n') +
                    `\n\n🔔 *Une alerte privée vous sera envoyée dès leur apparition en boutique.*`
                )
                .setFooter({ text: 'RadianiteBot • Surveillance Wishlist 24/7' });

            return interaction.editReply({ embeds: [listEmbed] });
        }
    }

    // 7. /scout Command (Live Match Intelligence & Scouting)
    if (commandName === 'scout') {
        await interaction.deferReply({ ephemeral: false });

        let targetRiotId = interaction.options.getString('joueur');

        if (!targetRiotId) {
            // Find from user's linked account or first followed player
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
                content: `❌ **Veuillez préciser un joueur à analyser :** \`/scout joueur: Pseudo#TAG\``
            });
        }

        const [name, tag] = targetRiotId.split('#');

        try {
            const [mmrRes, matchesRes] = await Promise.all([
                henrikApi.get(`/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`).catch(() => null),
                henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=5`).catch(() => null)
            ]);

            const mmrData = mmrRes?.data?.data?.current_data || {};
            const highestTier = mmrRes?.data?.data?.highest_rank?.patched_tier || 'Inconnu';
            const currentTier = mmrData.currenttierpatched || 'Non-classé';
            const currentRR = mmrData.ranking_in_tier || 0;
            const elo = mmrData.elo || 0;

            const matches = matchesRes?.data?.data || [];
            let wins = 0;
            let totalKills = 0, totalDeaths = 0;
            const agentCounts = {};

            matches.forEach(m => {
                const allP = m.players?.all_players || [];
                const p = allP.find(x => x.name.toLowerCase() === name.toLowerCase());
                if (p) {
                    const team = m.teams?.[p.team?.toLowerCase()];
                    if (team?.has_won) wins++;
                    totalKills += p.stats?.kills || 0;
                    totalDeaths += p.stats?.deaths || 0;
                    const char = p.character || 'Inconnu';
                    agentCounts[char] = (agentCounts[char] || 0) + 1;
                }
            });

            const topAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Inconnu';
            const recentKD = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;
            const winrate = matches.length > 0 ? Math.round((wins / matches.length) * 100) : 0;

            const scoutEmbed = new EmbedBuilder()
                .setTitle(`🕵️ DOSSIER TACTIQUE & SCOUTING • ${targetRiotId.toUpperCase()}`)
                .setColor(0x00f5d4)
                .setDescription(
                    `🏆 **Rang Actuel :** **${currentTier}** (${currentRR} RR • ELO ${elo})\n` +
                    `👑 **Peak Rank :** **${highestTier}**\n` +
                    `────────────────────────────────────────\n` +
                    `📊 **Performance sur les 5 derniers matchs :**\n` +
                    `⚔️ **K/D Moyen :** **${recentKD}** (${totalKills} Kills / ${totalDeaths} Morts)\n` +
                    `🎯 **Winrate Récent :** **${winrate}%** (${wins}V - ${matches.length - wins}D)\n` +
                    `⭐ **Agent Préféré :** **${topAgent}**\n` +
                    `────────────────────────────────────────\n` +
                    `🔗 [Consulter le profil complet sur RadianiteDB](${YOUR_WEBSITE_URL}/#tracker)`
                )
                .setThumbnail(mmrData.images?.small || 'https://media.valorant-api.com/competitivetiers/03621f52-4cd8-5eab-4e5e-a4b5d63f9157/24/smallicon.png')
                .setFooter({ text: 'RadianiteDB Intelligence Suite' })
                .setTimestamp();

            return interaction.editReply({ embeds: [scoutEmbed] });

        } catch (err) {
            console.error('[RadianiteBot] Erreur /scout:', err.message);
            return interaction.editReply({
                content: `❌ Impossible de récupérer les données tactiques pour **${targetRiotId}**.`
            });
        }
    }

    // 8. /classement Command (Server / Followed Players Leaderboard)
    if (commandName === 'classement') {
        await interaction.deferReply({ ephemeral: false });

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
                    content: `🏆 Aucun joueur surveillé n'est encore enregistré dans la base de données. Liez votre compte avec **/login** ou suivez des joueurs sur le site !`
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
                    content: `🏆 Impossible de récupérer les classements des joueurs enregistrés.`
                });
            }

            leaderboardList.sort((a, b) => b.elo - a.elo);

            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            const lbEmbed = new EmbedBuilder()
                .setTitle(`🏆 CLASSEMENT COMPÉTITIF DU SERVEUR`)
                .setColor(0xffb703)
                .setDescription(
                    `Classement des joueurs suivis ordonné par **Rang & RR** :\n\n` +
                    leaderboardList.map((p, idx) => {
                        const medal = medals[idx] || '▫️';
                        return `${medal} **${idx + 1}. ${p.riotId}** — **${p.tierName}** (${p.rr} RR)`;
                    }).join('\n\n') +
                    `\n\n────────────────────────────────────────\n` +
                    `🌐 *Mis à jour en temps réel via l'API officielle.*`
                )
                .setThumbnail('https://media.valorant-api.com/competitivetiers/03621f52-4cd8-5eab-4e5e-a4b5d63f9157/27/smallicon.png')
                .setTimestamp();

            return interaction.editReply({ embeds: [lbEmbed] });

        } catch (err) {
            console.error('[RadianiteBot] Erreur /classement:', err);
            return interaction.editReply({ content: `❌ Erreur lors du calcul du classement.` });
        }
    }

    // 9. /session Command (Past 24h Session Summary)
    if (commandName === 'session') {
        await interaction.deferReply({ ephemeral: false });

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
                content: `❌ **Veuillez préciser un joueur :** \`/session joueur: Pseudo#TAG\``
            });
        }

        const report = await generateSessionReport(targetRiotId);
        if (!report) {
            return interaction.editReply({
                content: `ℹ️ **Aucune partie jouée sur les dernières 24h pour ${targetRiotId}.**`
            });
        }

        return interaction.editReply({ embeds: [report] });
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
        .select('followed_players.riot_id', 'users.discord_channel_id', 'users.discord_id', 'users.show_rank_wheel');

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
                    if (isCompetitive) {
                        try {
                            const statsRes = await localApi.get(`/api/stats/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
                            if (statsRes.data?.rankInfo) {
                                const rInfo = statsRes.data.rankInfo;
                                if (rInfo.lastRRChange !== undefined) {
                                    const val = rInfo.lastRRChange;
                                    rrChange = val > 0 ? `+${val} RR` : `${val} RR`;
                                }
                                const currentRR = rInfo.currentRR ?? rInfo.rr ?? 50;
                                const rankTierNum = rInfo.currentTier ?? rInfo.tier ?? 18;
                                const rawChangeNum = rInfo.lastRRChange || 0;
                                rankWheelUrl = `${YOUR_WEBSITE_URL}/api/rank-wheel?rr=${currentRR}&change=${rawChangeNum}&tier=${rankTierNum}&size=360&t=${Date.now()}`;
                            }
                        } catch (e) {
                            // Direct HenrikDev fallback
                            try {
                                const mmrRes = await henrikApi.get(`/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
                                const cData = mmrRes.data?.data?.current_data;
                                if (cData) {
                                    const rawChangeNum = cData.mmr_change_to_last_game || 0;
                                    rrChange = rawChangeNum > 0 ? `+${rawChangeNum} RR` : `${rawChangeNum} RR`;
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

    // 3. Group by User/Channel and Match ID (DuoQ / TrioQ / 5-Stack grouping)
    const userSubs = new Map(); // discord_id -> { channel, user, showRankWheel, followedRiotIds: [] }
    for (const sub of subscriptions) {
        if (!userSubs.has(sub.discord_id)) {
            userSubs.set(sub.discord_id, {
                channel: sub.discord_channel_id,
                user: sub.discord_id,
                showRankWheel: sub.show_rank_wheel !== false,
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
                const modeDisplay = first.modeDisplay;
                const team = first.team;

                const isSquad = squadPlayers.length > 1;
                const squadTitle = squadPlayers.length === 2 ? 'DUOQ' : squadPlayers.length === 3 ? 'TRIOQ' : squadPlayers.length === 5 ? '5-STACK' : `${squadPlayers.length}-STACK`;

                let title = '';
                let color = 0x00f5d4;

                if (isDeathmatch) {
                    const isDmWin = first.isDmWin;
                    color = isDmWin ? 0x00f5d4 : (first.placement <= 3 ? 0xffb703 : 0xff4655);
                    title = isSquad 
                        ? `🎯 MATCH À MORT • SQUAD ${squadTitle}`
                        : `${isDmWin ? '🏆 VICTOIRE' : `💀 TOP ${first.placement}`} (${first.dmScore}) • ${first.riotId}`;
                } else {
                    const hasWon = team.has_won;
                    color = hasWon ? 0x00f5d4 : 0xff4655;
                    const resultText = hasWon ? 'VICTOIRE' : 'DÉFAITE';
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

                // Thumbnail: In Competitive / Ranked, display the dynamic Rank Wheel with RR delta!
                // In non-ranked modes (Unrated, Spike Rush, Deathmatch), display the Agent icon!
                if (isCompetitive && first.rankWheelUrl && userData.showRankWheel !== false) {
                    mainEmbed.setThumbnail(first.rankWheelUrl);
                } else if (first.playerStats?.assets?.agent?.small) {
                    mainEmbed.setThumbnail(first.playerStats.assets.agent.small);
                }

                const embedsToSend = [mainEmbed];

                // Add each player with their horizontal player card banner delimiter
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
                        // Deathmatch: Score is kills/deaths, placement shown
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character}) • ${pData.isDmWin ? '🏆 Top 1 (Victoire)' : `Top ${pData.placement}/${match.players?.all_players?.length || 12}`}`,
                            value: `🎯 **Score :** **${kills} Kills / ${deaths} Morts** (${kd} KD)\n` +
                                   `💥 **Assists :** ${assists} | 🎯 **Tirs Tête :** ${p.stats?.headshots || 0} (${hsPercent}%)\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else if (pData.isCompetitive) {
                        // Ranked / Competitive: Includes RR change
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **HS :** ${hsPercent}%\n` +
                                   `📈 **Évolution RR :** **${pData.rrChange || '±0 RR'}**\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    } else {
                        // Unrated / Swiftplay / Spike Rush / Other: Pure stats, NO RR change
                        mainEmbed.addFields({
                            name: `👤 ${idx + 1}. ${pData.riotId} (${p.character})`,
                            value: `⚔️ **K/D/A :** ${kills}/${deaths}/${assists} (${kd} KD)\n` +
                                   `💥 **ACS :** ${acs} | 🎯 **HS :** ${hsPercent}%\n` +
                                   `────────────────────────────────────────`,
                            inline: false
                        });
                    }

                    // Horizontal Player Card Banner Embed (Delimiting each player)
                    if (p.assets?.card?.wide || p.assets?.card?.large) {
                        const bannerEmbed = new EmbedBuilder()
                            .setColor(color)
                            .setImage(p.assets.card.wide || p.assets.card.large)
                            .setFooter({ text: `${pData.riotId} • ${p.character} • ${pData.modeDisplay}` });
                        embedsToSend.push(bannerEmbed);
                    }
                });

                // Limit embeds to 10 max per Discord API specs
                const finalEmbeds = embedsToSend.slice(0, 10);

                await channel.send({
                    content: `<@${userData.user}>, ${isSquad ? `vos joueurs suivis en **${squadTitle}** ont terminé leur partie (${modeDisplay}) !` : `**${first.riotId}** a terminé sa partie (${modeDisplay}) !`}`,
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

// --- HELPER: GENERATE 24H SESSION REPORT ---
async function generateSessionReport(riotId) {
    const [name, tag] = riotId.split('#');
    if (!name || !tag) return null;

    try {
        const res = await henrikApi.get(`/valorant/v3/matches/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=15`).catch(() => null);
        const allMatches = res?.data?.data || [];
        const past24hCutoff = Math.floor(Date.now() / 1000) - 86400;

        const sessionMatches = allMatches.filter(m => (m.metadata?.game_start || 0) >= past24hCutoff);
        if (sessionMatches.length === 0) return null;

        let wins = 0;
        let totalKills = 0, totalDeaths = 0, totalAssists = 0;
        let totalScore = 0, totalRounds = 0;
        let headshots = 0, bodyshots = 0, legshots = 0;
        const agentStats = {};

        sessionMatches.forEach(m => {
            const players = m.players?.all_players || [];
            const p = players.find(x => x.name.toLowerCase() === name.toLowerCase());
            if (p) {
                const team = m.teams?.[p.team?.toLowerCase()];
                if (team?.has_won) wins++;
                totalKills += p.stats?.kills || 0;
                totalDeaths += p.stats?.deaths || 0;
                totalAssists += p.stats?.assists || 0;
                totalScore += p.stats?.score || 0;
                totalRounds += m.metadata?.rounds_played || 1;
                headshots += p.stats?.headshots || 0;
                bodyshots += p.stats?.bodyshots || 0;
                legshots += p.stats?.legshots || 0;

                const char = p.character || 'Inconnu';
                if (!agentStats[char]) agentStats[char] = { played: 0, wins: 0 };
                agentStats[char].played++;
                if (team?.has_won) agentStats[char].wins++;
            }
        });

        const totalGames = sessionMatches.length;
        const losses = totalGames - wins;
        const winrate = Math.round((wins / totalGames) * 100);
        const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills;
        const acs = totalRounds > 0 ? Math.round(totalScore / totalRounds) : 0;
        const totalShots = headshots + bodyshots + legshots;
        const hsPercent = totalShots > 0 ? Math.round((headshots / totalShots) * 100) : 0;

        const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].played - a[1].played);
        const bestAgentName = sortedAgents[0]?.[0] || 'Inconnu';
        const bestAgentInfo = sortedAgents[0]?.[1] || { played: 0, wins: 0 };

        const embed = new EmbedBuilder()
            .setTitle(`☀️ RAPPORT DE SESSION • ${riotId.toUpperCase()}`)
            .setColor(winrate >= 50 ? 0x00f5d4 : 0xff4655)
            .setDescription(
                `📊 **Bilan des dernières 24 heures :**\n\n` +
                `🎮 **Parties jouées :** **${totalGames}** (${wins}V - ${losses}D • **${winrate}% Winrate**)\n` +
                `⚔️ **Ratio K/D :** **${kd}** (${totalKills} Kills / ${totalDeaths} Morts / ${totalAssists} Assists)\n` +
                `💥 **ACS Moyen :** **${acs}** | 🎯 **Précision Tête :** **${hsPercent}%**\n` +
                `⭐ **Agent Principal :** **${bestAgentName}** (${bestAgentInfo.played} parties • ${Math.round((bestAgentInfo.wins / bestAgentInfo.played) * 100)}% Winrate)\n` +
                `────────────────────────────────────────\n` +
                `🔗 [Détails complets sur RadianiteDB](${YOUR_WEBSITE_URL}/#tracker)`
            )
            .setThumbnail(AGENT_ASSETS[bestAgentName.toLowerCase()] || 'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png')
            .setFooter({ text: 'RadianiteBot • Briefing de Session Quotidien' })
            .setTimestamp();

        return embed;
    } catch (err) {
        console.error(`[RadianiteBot] Erreur rapport de session pour ${riotId}:`, err.message);
        return null;
    }
}

// --- CRON: DAILY 10h00 SESSION REPORT ---
async function sendDailySessionRecap() {
    console.log('[RadianiteBot] ⏰ Envoi automatique des rapports de session de 10h00...');
    try {
        const subscriptions = await knex('followed_players')
            .join('users', 'users.id', 'followed_players.user_id')
            .whereNotNull('users.discord_channel_id')
            .select('followed_players.riot_id', 'users.discord_channel_id', 'users.discord_id');

        for (const sub of subscriptions) {
            try {
                const report = await generateSessionReport(sub.riot_id);
                if (report) {
                    const channel = await client.channels.fetch(sub.discord_channel_id);
                    if (channel) {
                        await channel.send({
                            content: `☀️ <@${sub.discord_id}>, voici votre **briefing de session Valorant** des dernières 24h pour **${sub.riot_id}** :`,
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
        const users = await knex('users').whereNotNull('riot_auth').select('discord_id', 'riot_auth');
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
                            const alertEmbed = new EmbedBuilder()
                                .setTitle('🚨 ALERTE WISHLIST • VOTRE SKIN EST EN BOUTIQUE !')
                                .setColor(0x00f5d4)
                                .setDescription(
                                    `🎉 Bonne nouvelle ! Le skin **${skinInfo.displayName}** est disponible dans votre boutique Valorant aujourd'hui !\n\n` +
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
