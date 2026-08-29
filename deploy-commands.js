require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1436123733197590624';

const commands = [
    {
        name: 'boutique',
        description: 'Affiche votre boutique quotidienne Valorant en direct, vos soldes VP et le Marché Nocturne.',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez un lien Riot officiel si votre compte n\'est pas encore lié via /login',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'store',
        description: 'Affiche votre boutique quotidienne Valorant en direct (alias /boutique).',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez un lien Riot officiel si votre compte n\'est pas encore lié via /login',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'shop',
        description: 'Affiche votre boutique quotidienne Valorant en direct (alias /boutique).',
        options: [
            {
                name: 'lien_ou_token',
                description: 'Optionnel: Collez un lien Riot officiel si votre compte n\'est pas encore lié via /login',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'login',
        description: 'Connecte votre compte Riot (session persistante chiffrée, mot de passe jamais stocké en clair).',
        options: [
            {
                name: 'identifiant',
                description: 'Option 1: Votre nom d\'utilisateur Riot Games (login)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'mot_de_passe',
                description: 'Option 1: Votre mot de passe Riot Games',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'lien',
                description: 'Option 2: Collez directement votre lien officiel Riot (https://playvalorant.com/...#access_token=...)',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: '2fa',
        description: 'Valide le code d\'authentification à deux facteurs Riot Games reçu par email.',
        options: [
            {
                name: 'code',
                description: 'Le code à 6 chiffres reçu par email',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'unlink',
        description: 'Supprime définitivement votre session Riot enregistrée sur le bot.',
    },
    {
        name: 'setchannel',
        description: 'Définit ce salon Discord pour recevoir les alertes de fin de partie.',
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
