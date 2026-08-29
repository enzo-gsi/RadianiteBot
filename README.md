# 🎯 RadianiteBot // Discord Tracking Engine for Valorant

<div align="center">

![RadianiteBot Banner](https://media.valorant-api.com/maps/7eae3437-467b-4f05-83f3-8f96e05eef33/splash.png)

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14.24-5865F2.svg)](https://discord.js.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)](https://supabase.com/)
[![RadianiteDB](https://img.shields.io/badge/Companion%20Website-radianitedb.lol-00F5D4.svg)](https://radianitedb.lol)

**Le bot Discord officiel de [RadianiteDB](https://radianitedb.lol). Surveillance automatique des parties compétitives Valorant en temps réel, alertes de match ultra-détaillées et fiches de statistiques instantanées.**

[Site Web](https://radianitedb.lol) • [Commandes](#-commandes-slash) • [Installation](#-installation--déploiement) • [Configuration](#-variables-denvironnement)

</div>

---

## ⚡ Fonctionnalités Clés

- **🛒 Boutique Valorant en Direct (`/boutique`, `/store`, `/shop`)** : Affichez vos 4 skins quotidiens, vos soldes réels de VP, RP et Kingdom Credits, ainsi que le Marché Nocturne directement sur Discord !
- **🔐 Connexion Directe Riot Sécurisée (`/login`, `/2fa`)** : Authentification persistante avec chiffrement **AES-256-GCM** (mot de passe jamais stocké en clair, renouvellement automatique de session).
- **🚨 Alertes de Fin de Match Groupées (DuoQ / TrioQ / 5-Stack)** : Combine tous les joueurs d'une même partie en un seul rapport épuré avec **bannières horizontales larges** délimitant chaque profil.
- **🎯 Filtrage Intelligent des Modes** :
  - **Ranked (Compétitif)** : Affiche les stats complètes et l'évolution précise de RR (`+22 RR`).
  - **Non-Classé / Véloce / Spike Rush** : Affiche les stats pures et l'avatar de l'agent sans mention de RR ni de roue.
  - **Match à Mort (Deathmatch)** : Affiche le score en **Kills / Morts** et le classement final (`Top 1 (Victoire)`).

---

## 🎮 Commandes Slash

| Commande | Options | Description |
| :--- | :--- | :--- |
| **`/boutique`** | `[lien_ou_token]` | Affiche votre boutique Valorant du jour, vos soldes VP/RP/KC et le Marché Nocturne. |
| **`/store`** | `[lien_ou_token]` | Alias de `/boutique`. |
| **`/shop`** | `[lien_ou_token]` | Alias de `/boutique`. |
| **`/login`** | `identifiant:` `mot_de_passe:` | Connecte votre compte Riot de manière sécurisée (session persistante chiffrée AES-256). |
| **`/2fa`** | `code:` | Valide le code de double authentification Riot Games reçu par email. |
| **`/unlink`** | *Aucune* | Supprime définitivement votre session Riot enregistrée sur le bot. |
| **`/setchannel`** | *Aucune* | Définit le salon textuel où le bot doit publier les alertes de match. |

---

## 🚀 Installation & Déploiement

### Prérequis
- **Node.js** 18.0.0 ou supérieur
- Un compte **[Discord Developer Portal](https://discord.com/developers/applications)**
- Une clé d'API **[HenrikDev](https://henrikdev.xyz)**

### 1. Cloner le Dépôt
```bash
git clone https://github.com/ewenguilhot8-netizen/RadianiteBot.git
cd RadianiteBot
```

### 2. Installer les Dépendances
```bash
npm install
```

### 3. Configurer l'Environnement
Créez un fichier `.env` basé sur `.env.example` :
```env
DISCORD_BOT_TOKEN=VOTRE_BOT_TOKEN_DISCORD
DISCORD_CLIENT_ID=1436123733197590624
HENRIK_API_KEY=HDEV-xxxx-xxxx-xxxx-xxxx
DATABASE_URL=postgresql://postgres.xxx:password@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
WEBSITE_URL=https://radianitedb.lol
```

### 4. Lancer le Bot
```bash
npm start
```

---

## 🌐 Déploiement sur Hébergeur Gratuit (Bot-Hosting / Discloud / VPS)

### Sur Bot-Hosting.net
1. Créez un serveur Node.js sur [Bot-Hosting.net](https://bot-hosting.net).
2. Uploadez les fichiers `bot.js`, `database.js`, `package.json` et `.env`.
3. Dans la console, tapez `npm install`.
4. Cliquez sur **Start**.

### Sur Discloud
Le fichier `discloud.config` est déjà inclus :
```ini
ID=radianitebot
TYPE=bot
MAIN=bot.js
NAME=RadianiteBot
RAM=100
AUTORESTART=true
VERSION=latest
```
Zippez le contenu du dossier et uploadez-le sur Discloud.

---

## 🗄️ Architecture de Données (Supabase PostgreSQL)

Le bot se connecte directement aux tables de la base RadianiteDB :
- `users` : Comptes utilisateurs Discord liés et salons d'alertes configurés (`discord_channel_id`).
- `followed_players` : Abonnements et joueurs surveillés par chaque utilisateur.
- `bot_memory` : Mémoire de déduplication pour ne jamais annoncer deux fois le même match (`last_match_id`).

---

## 📄 Licence
Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

---
<div align="center">
  Développé avec ❤️ pour la communauté Valorant par l'équipe <strong>RadianiteDB</strong>.
</div>
