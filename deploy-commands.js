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
