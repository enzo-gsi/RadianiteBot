require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1436123733197590624';

const commands = [
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
        name: 'scout',
        description: 'Scout player profile: rank, winrate, headshot accuracy & weapon mastery.',
        options: [
            {
                name: 'player',
                description: 'Optional: Player name#TAG to analyze',
                type: ApplicationCommandOptionType.String,
                required: false
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

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function deploy() {
    try {
        console.log(`[Deploy] Déploiement de ${commands.length} commandes Slash (Global)...`);
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log('[Deploy] ✅ Commandes Slash globales enregistrées avec succès !');
    } catch (error) {
        console.error('[Deploy] ❌ Erreur lors du déploiement des commandes:', error);
    }
}

deploy();
