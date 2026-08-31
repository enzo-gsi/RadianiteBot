const axios = require('axios');
const crypto = require('crypto');

// Secret key for AES-256 encryption (from env or fallback sha256 hash)
const ENCRYPTION_SECRET = process.env.SESSION_SECRET || process.env.DISCORD_BOT_TOKEN || 'radianitedb-valorant-tracker-encryption-key-2026';
const KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
const ALGORITHM = 'aes-256-gcm';

const USER_AGENT = 'RiotClient/104.0.0.2185.1054 rso-auth (Windows;10;;Professional, x64)';
const CLIENT_PLATFORM = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

// AES-256-GCM Encrypt
function encryptData(obj) {
    try {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    } catch (err) {
        console.error('[Crypto] Encryption error:', err.message);
        return null;
    }
}

// AES-256-GCM Decrypt
function decryptData(encryptedStr) {
    try {
        if (!encryptedStr || !encryptedStr.includes(':')) return null;
        const [ivHex, tagHex, encryptedHex] = encryptedStr.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    } catch (err) {
        console.error('[Crypto] Decryption error:', err.message);
        return null;
    }
}

// Helper: Extract cookies into a Map / string
function parseCookies(setCookieHeader, existingCookieMap = {}) {
    const cookieMap = { ...existingCookieMap };
    if (!setCookieHeader) return cookieMap;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const cookie of list) {
        const parts = cookie.split(';')[0].split('=');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            cookieMap[name] = value;
        }
    }
    return cookieMap;
}

function cookieMapToString(cookieMap) {
    return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Helper: Extract tokens from response URI
function extractTokensFromUri(uri) {
    if (!uri) return { accessToken: null, idToken: null };
    const hash = uri.includes('#') ? uri.split('#')[1] : uri;
    const params = new URLSearchParams(hash);
    let accessToken = params.get('access_token');
    let idToken = params.get('id_token');

    if (!accessToken) {
        const matchAcc = hash.match(/access_token=([^&]+)/);
        if (matchAcc) accessToken = decodeURIComponent(matchAcc[1]);
    }
    if (!idToken) {
        const matchId = hash.match(/id_token=([^&]+)/);
        if (matchId) idToken = decodeURIComponent(matchId[1]);
    }
    return { accessToken, idToken };
}

// 1. Direct RSO Login with Username & Password
async function loginRiotRSO(username, password) {
    try {
        // Step A: Initialize Authorization Handshake
        const initRes = await axios.post('https://auth.riotgames.com/api/v1/authorization', {
            client_id: 'play-valorant-web-prod',
            nonce: '1',
            redirect_uri: 'https://playvalorant.com/opt_in',
            response_type: 'token id_token',
            scope: 'account openid'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        });

        let cookieMap = parseCookies(initRes.headers['set-cookie']);

        // Step B: Submit Credentials (remember: true for persistent session cookies)
        const authRes = await axios.put('https://auth.riotgames.com/api/v1/authorization', {
            type: 'auth',
            username: username.trim(),
            password: password,
            remember: true
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieMapToString(cookieMap),
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        });

        cookieMap = parseCookies(authRes.headers['set-cookie'], cookieMap);

        // Check response type
        if (authRes.data?.type === 'response') {
            const uri = authRes.data.response?.parameters?.uri;
            const { accessToken, idToken } = extractTokensFromUri(uri);
            if (!accessToken) {
                return { success: false, error: 'missing_token' };
            }

            // Fetch Entitlements, PUUID, and User info
            const sessionData = await buildSessionPayload(accessToken, idToken, cookieMap);
            return { success: true, session: sessionData };

        } else if (authRes.data?.type === 'multifactor') {
            const email = authRes.data.multifactor?.email || 'votre email';
            return {
                success: false,
                requires2FA: true,
                email: email,
                cookies: cookieMap
            };
        } else if (authRes.data?.error === 'auth_failure') {
            return { success: false, error: 'Identifiant ou mot de passe incorrect.' };
        } else if (authRes.data?.error === 'rate_limited') {
            return { success: false, error: 'Trop de tentatives de connexion Riot. Veuillez patienter 5 minutes.' };
        } else {
            return { success: false, error: authRes.data?.error || 'Erreur d\'authentification Riot Games inconnue.' };
        }

    } catch (err) {
        console.error('[RiotAuth] Login error:', err.message);
        return { success: false, error: err.message };
    }
}

// 2. Submit 2FA Code
async function submit2FACode(code, cookieMap) {
    try {
        const res = await axios.put('https://auth.riotgames.com/api/v1/authorization', {
            type: 'multifactor',
            code: String(code).trim(),
            rememberDevice: true
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieMapToString(cookieMap),
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        });

        const updatedCookies = parseCookies(res.headers['set-cookie'], cookieMap);

        if (res.data?.type === 'response') {
            const uri = res.data.response?.parameters?.uri;
            const { accessToken, idToken } = extractTokensFromUri(uri);
            if (!accessToken) {
                return { success: false, error: 'missing_token' };
            }

            const sessionData = await buildSessionPayload(accessToken, idToken, updatedCookies);
            return { success: true, session: sessionData };
        } else {
            return { success: false, error: 'Code 2FA incorrect ou expiré.' };
        }
    } catch (err) {
        console.error('[RiotAuth] 2FA error:', err.message);
        return { success: false, error: err.message };
    }
}

// 3. Build Full Session Payload (Entitlements, PUUID, Riot ID, Shard)
async function buildSessionPayload(accessToken, idToken, cookieMap) {
    const [entRes, userRes] = await Promise.all([
        axios.post('https://entitlements.auth.riotgames.com/api/token/v1', {}, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        }),
        axios.get('https://auth.riotgames.com/userinfo', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        })
    ]);

    const entitlementsToken = entRes.data.entitlements_token;
    const puuid = userRes.data.sub;
    const username = userRes.data.acct?.game_name ? `${userRes.data.acct.game_name}#${userRes.data.acct.tag_line}` : (userRes.data.preferred_username || 'Agent');
    const shard = userRes.data.affinity?.pp ? userRes.data.affinity.pp.toLowerCase() : 'eu';

    return {
        accessToken,
        idToken,
        entitlementsToken,
        puuid,
        username,
        shard,
        cookieMap,
        updatedAt: Date.now()
    };
}

// 4. Silent Token Refresh via Persistent Session Cookies
async function refreshRiotSession(sessionData) {
    try {
        if (!sessionData?.cookieMap || !sessionData.cookieMap.ssid) {
            return null;
        }

        const res = await axios.post('https://auth.riotgames.com/api/v1/authorization', {
            client_id: 'play-valorant-web-prod',
            nonce: '1',
            redirect_uri: 'https://playvalorant.com/opt_in',
            response_type: 'token id_token',
            scope: 'account openid'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieMapToString(sessionData.cookieMap),
                'User-Agent': USER_AGENT
            },
            validateStatus: () => true
        });

        const updatedCookies = parseCookies(res.headers['set-cookie'], sessionData.cookieMap);

        if (res.data?.type === 'response') {
            const uri = res.data.response?.parameters?.uri;
            const { accessToken, idToken } = extractTokensFromUri(uri);
            if (accessToken) {
                return await buildSessionPayload(accessToken, idToken, updatedCookies);
            }
        }
        return null;
    } catch (err) {
        console.warn('[RiotAuth] Session refresh notice:', err.message);
        return null;
    }
}

// 5. Fetch Full Live Valorant Storefront & Balances
async function fetchStorefront(session, clientVersion = 'release-13.04-shipping-18-5304478') {
    let currentSession = session;

    const performFetch = async (auth) => {
        const pdUrl = `https://pd.${auth.shard || 'eu'}.a.pvp.net`;
        const headers = {
            'Authorization': `Bearer ${auth.accessToken}`,
            'X-Riot-Entitlements-JWT': auth.entitlementsToken,
            'X-Riot-ClientVersion': clientVersion,
            'X-Riot-ClientPlatform': CLIENT_PLATFORM,
            'Content-Type': 'application/json'
        };

        const [storeRes, walletRes] = await Promise.all([
            axios.post(`${pdUrl}/store/v3/storefront/${auth.puuid}`, {}, { headers, timeout: 12000 }),
            axios.get(`${pdUrl}/store/v1/wallet/${auth.puuid}`, { headers, timeout: 12000 }).catch(() => ({ data: { Balances: {} } }))
        ]);

        return {
            store: storeRes.data,
            wallet: walletRes.data?.Balances || {},
            session: auth
        };
    };

    try {
        return await performFetch(currentSession);
    } catch (err) {
        // If 400/401 Unauthorized, try silent session refresh!
        if (err.response?.status === 401 || err.response?.status === 400) {
            console.log('[RiotAuth] Access token expired, attempting silent cookie refresh...');
            const refreshed = await refreshRiotSession(currentSession);
            if (refreshed) {
                return await performFetch(refreshed);
            }
        }
        throw err;
    }
}

module.exports = {
    encryptData,
    decryptData,
    loginRiotRSO,
    submit2FACode,
    refreshRiotSession,
    fetchStorefront,
    extractTokensFromUri
};
