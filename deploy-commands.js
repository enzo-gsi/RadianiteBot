require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1436123733197590624';

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
        name: 'leaderboard',
        description: 'Server competitive leaderboard (Top RR, Tiers, K/D).',
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
