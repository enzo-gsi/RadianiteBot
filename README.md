# 🎯 RadianiteBot // Discord Tracking Engine for Valorant

<div align="center">

![RadianiteBot Banner](https://media.valorant-api.com/maps/7eae3437-467b-4f05-83f3-8f96e05eef33/splash.png)

[![GitHub stars](https://img.shields.io/github/stars/enzo-gsi/RadianiteBot?style=flat&color=00f5d4)](https://github.com/enzo-gsi/RadianiteBot)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14.24-5865F2.svg)](https://discord.js.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)](https://supabase.com/)
[![RadianiteDB](https://img.shields.io/badge/Companion%20Website-radianitedb.lol-00F5D4.svg)](https://radianitedb.lol)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Le bot Discord officiel de [RadianiteDB](https://radianitedb.lol). Surveillance automatique des parties compétitives Valorant en temps réel, alertes de match groupées ultra-détaillées, boutique 24h & alertes Wishlist en MP, fiches de statistiques interactives et classements de serveur.**

[Site Officiel](https://radianitedb.lol) • [Commandes Slash](#-commandes-slash) • [Tâches Automatiques](#-t%C3%A2ches-automatis%C3%A9es-cron-jobs) • [Installation](#-installation--d%C3%A9ploiement) • [Configuration](#-variables-denvironnement) • [Architecture](#%EF%B8%8F-architecture--base-de-donn%C3%A9es)

</div>

---

## ⚡ Fonctionnalités Clés

- **🚨 Suivi de Matchs en Direct & Alertes Groupées (DuoQ / TrioQ / 5-Stack)** : Vérification automatique toutes les 3 minutes. Détecte les parties terminées et publie des rapports esthétiques avec bannières larges, K/D, ACS, HS %, différentiel net de RR et détection automatique des montées de rang (Rank-Up).
- **🛒 Boutique Valorant en Direct (`/store`, `/boutique`, `/shop`)** : Affichez vos 4 skins quotidiens avec leurs visuels et tarifs, vos soldes en direct de VP, RP et Kingdom Credits, ainsi que les réductions du Marché Nocturne.
- **⭐ Wishlist & Alertes Privées Automatiques (`/wishlist`)** : Enregistrez vos skins favoris avec autocomplétion intelligente. Le bot analyse les boutiques à **02h05 CET** et vous envoie un **Message Privé (MP)** dès qu'un skin souhaité apparaît.
- **📜 Historique des Matchs & Roue de RR (`/history`, `/historique`)** : Explorez jusqu'à 50 matchs récents avec pagination dynamique (5 matchs/page), filtre par mode de jeu (Compétitif, Non-classé, Véloce, TDM, etc.), indicateur visuel d'évolution des RR et tableaux de scores complets des 10 joueurs du lobby.
- **☀️ Bilan de Session Quotidien (`/session` & Cron 10h00)** : Synthèse complète des dernières 24 heures (Victoires, Défaites, Winrate %, K/D, ACS, Agent de prédilection, gain/perte net de RR), envoyé automatiquement chaque matin à **10h00**.
- **🏆 Leaderboard Compétitif de Serveur (`/leaderboard`)** : Classement en direct des joueurs suivis sur le serveur Discord, ordonné par rang, palier et RR avec podium médaillé (🥇, 🥈, 🥉).
- **👥 Système de Suivi Intégré (`/follow`, `/unfollow`)** : Suivez n'importe quel joueur (`Pseudo#TAG`) sur votre serveur en une simple commande pour activer les alertes automatiques.
- **⚙️ Panneau de Configuration Serveur (`/settings`, `/config`)** : Personnalisez le salon de diffusion, activez/désactivez les mentions des joueurs, limitez les alertes aux seuls Rank-Ups et configurez la langue du serveur.
- **🌍 Internationalisation Native (Multilingue)** : Interface disponible en 4 langues : 🇺🇸 Anglais, 🇫🇷 Français, 🇪🇸 Espagnol, 🇩🇪 Allemand.

---

## 🎮 Commandes Slash

| Commande | Options | Description |
| :--- | :--- | :--- |
| **`/store`** *(alias `/boutique`, `/shop`)* | `[link_or_token]` | Affiche votre boutique quotidienne Valorant, soldes VP/RP/KC et Marché Nocturne. |
| **`/history`** *(alias `/historique`)* | `[player]` `[mode]` | Historique interactif (5 matchs/page), roue de tendance RR et scoreboards complets du lobby. |
| **`/session`** | `[player]` | Bilan détaillé des parties et gains/pertes de RR sur les dernières 24 heures. |
| **`/wishlist add`** | `skin: [Nom]` | Ajoute un skin d'arme à surveiller dans votre boutique quotidienne (autocomplétion). |
| **`/wishlist remove`** | `skin: [Nom]` | Retire un skin d'arme de votre liste de surveillance. |
| **`/wishlist list`** | *Aucune* | Affiche tous vos skins d'armes actuellement surveillés. |
| **`/leaderboard`** | *Aucune* | Classement compétitif des joueurs suivis sur le serveur (RR, Rang, K/D). |
| **`/follow`** | `player: [Pseudo#TAG]` | Suit un joueur Valorant pour recevoir ses alertes de fin de match et de montée de rang. |
| **`/unfollow`** | `player: [Pseudo#TAG]` | Arrête le suivi d'un joueur sur le serveur. |
| **`/settings`** *(alias `/config`)* | *Aucune* | Panneau interactif de réglages (salon, mentions, alertes rank-up, roue RR, langue). |
| **`/setchannel`** | `[channel]` | Définit le salon textuel Discord pour les alertes de fin de match et bilans matinaux. |
| **`/language`** | `lang: [en/fr/es/de]` | Modifie la langue des réponses du bot (🇺🇸 EN, 🇫🇷 FR, 🇪🇸 ES, 🇩🇪 DE). |
| **`/login`** | `[username]` `[password]` `[link]` | Connecte votre compte Riot de manière sécurisée (chiffrement AES-256-GCM). |
| **`/2fa`** | `code: [6 chiffres]` | Valide le code de sécurité 2FA reçu par email lors de la connexion Riot. |
| **`/unlink`** | *Aucune* | Supprime immédiatement et définitivement toutes vos données de session Riot. |
| **`/help`** | *Aucune* | Affiche le guide complet d'utilisation et la liste des commandes. |

---

## ⏰ Tâches Automatisées (Cron Jobs)

RadianiteBot intègre un moteur de background autonome haute performance :
- **⏱️ Toutes les 3 minutes (`*/3 * * * *`)** : Vérification des nouveaux matchs joués par les joueurs suivis (`checkFollowedPlayers`). Regroupement automatique des escouades (Duo, Trio, 5-Stack) et déduplication intelligente pour ne jamais notifier deux fois le même match.
- **🌙 Tous les jours à 02h05 CET (`5 2 * * *`)** : Vérification des Wishlists (`checkWishlists`) lors de la rotation de boutique Riot. Envoi automatique d'un MP aux utilisateurs concernés.
- **☀️ Tous les jours à 10h00 (`0 10 * * *`)** : Envoi du rapport matinal de session (`sendDailySessionRecap`) résumant la session de la veille dans les salons configurés.
- **📊 Toutes les 5 minutes** : Synchronisation de la télémétrie des serveurs et de l'activité (`syncGuildsAnalytics`) dans PostgreSQL.

---

## 🚀 Installation & Déploiement

### Prérequis
- **Node.js** 18.0.0 ou supérieur
- Un compte **[Discord Developer Portal](https://discord.com/developers/applications)** (avec intents *Guilds*, *GuildMessages* et *MessageContent* activés)
- Une clé d'API **[HenrikDev](https://henrikdev.xyz)**
- Une base de données **PostgreSQL** (ex. [Supabase](https://supabase.com))

### 1. Cloner le Dépôt
```bash
git clone https://github.com/enzo-gsi/RadianiteBot.git
cd RadianiteBot
```

### 2. Installer les Dépendances
```bash
npm install
```

### 3. Configurer les Variables d'Environnement
Créez un fichier `.env` basé sur `.env.example` :
```env
# Discord Bot
DISCORD_BOT_TOKEN=VOTRE_BOT_TOKEN_DISCORD
DISCORD_CLIENT_ID=1436123733197590624
OWNER_DISCORD_ID=VOTRE_ID_DISCORD

# HenrikDev API (Valorant)
HENRIK_API_KEY=HDEV-xxxx-xxxx-xxxx-xxxx

# Supabase PostgreSQL Database Pooler
DATABASE_URL=postgresql://postgres.xxx:password@aws-0-eu-west-2.pooler.supabase.com:5432/postgres

# RadianiteDB Website URL
WEBSITE_URL=https://radianitedb.lol
```

### 4. Déployer les Commandes Slash & Lancer le Bot
```bash
# Démarrage du bot (les commandes Slash globales sont enregistrées automatiquement au démarrage)
npm start
```

---

## 🌐 Déploiement Cloud (VPS, Discloud, Bot-Hosting)

### Déploiement sur Discloud
Le fichier `discloud.config` est configuré et prêt à l'emploi :
```ini
ID=radianitebot
TYPE=bot
MAIN=bot.js
NAME=RadianiteBot
RAM=100
AUTORESTART=true
VERSION=latest
```
Zippez le contenu du dossier (hors `node_modules` et `.env`) et importez-le sur [Discloud](https://discloudbot.com).

### Déploiement sur Bot-Hosting.net
1. Créez un conteneur Node.js sur [Bot-Hosting.net](https://bot-hosting.net).
2. Déposez `bot.js`, `database.js`, `riotAuth.js`, `package.json` et votre `.env`.
3. Lancez `npm install` dans la console puis démarrez l'application.

---

## 🗄️ Architecture & Base de Données (PostgreSQL)

Le bot utilise Knex et pg pour communiquer avec la base Supabase PostgreSQL :
- **`guild_configs`** : Configuration par serveur (salon dédié `channel_id`, langue `language`, notifications `notify_mentions`, `notify_rankup_only`, etc.).
- **`users`** : Préférences utilisateurs, sessions Riot chiffrées (`riot_auth`), langue et salon d'annonces personnel.
- **`followed_players`** : Joueurs Valorant suivis par les serveurs Discord (`player_name`, `tag`, `puuid`, `region`).
- **`wishlist`** : Skins d'armes surveillés par utilisateur Discord avec `skin_uuid` et nom.
- **`bot_memory`** : Déduplication de match (`last_match_id`) pour garantir une notification unique.
- **`bot_analytics`** : Statistiques d'utilisation globale, métriques de commandes et état des serveurs.

---

## 🔒 Sécurité & Confidentialité
- Les identifiants et jetons de session Riot sont chiffrés avec l'algorithme **AES-256-GCM**.
- Votre mot de passe n'est **jamais stocké en clair**.
- La commande **`/unlink`** permet à tout moment de purger l'intégralité de vos données.
- Pour plus d'informations, consultez notre [Politique de Confidentialité](PRIVACY.md) et nos [Conditions d'Utilisation](TERMS.md).

---

## 📄 Licence
Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

<div align="center">
  Développé avec ❤️ pour la communauté Valorant par l'équipe <strong>RadianiteDB</strong>.<br>
  <sub>VALORANT est une marque déposée de Riot Games, Inc. RadianiteBot n'est ni affilié ni approuvé par Riot Games.</sub>
</div>
