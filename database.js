const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

async function initDatabase() {
    if (!pool) return;
    try {
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS riot_auth TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS show_rank_wheel BOOLEAN DEFAULT true;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_mentions BOOLEAN DEFAULT true;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_rankup_only BOOLEAN DEFAULT false;

            CREATE TABLE IF NOT EXISTS wishlist (
                id SERIAL PRIMARY KEY,
                discord_id VARCHAR(64) NOT NULL,
                skin_uuid VARCHAR(128) NOT NULL,
                skin_name VARCHAR(128) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(discord_id, skin_uuid)
            );

            CREATE TABLE IF NOT EXISTS bot_analytics (
                key VARCHAR(128) PRIMARY KEY,
                count BIGINT DEFAULT 0,
                meta TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (err) {}
}
initDatabase();

function knex(tableName) {
    if (!pool) {
        return {
            where: () => ({ first: async () => null, select: async () => [], update: async () => 0, del: async () => 0 }),
            join: () => ({ whereNotNull: () => ({ select: async () => [] }) }),
            insert: async () => []
        };
    }

    if (tableName === 'users') {
        return {
            where: (filter) => ({
                first: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM users WHERE ${whereClause} LIMIT 1`, values);
                    return res.rows[0] || null;
                },
                select: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM users WHERE ${whereClause}`, values);
                    return res.rows;
                },
                update: async (updateObj) => {
                    const filterKeys = Object.keys(filter);
                    const filterValues = Object.values(filter);
                    const updateKeys = Object.keys(updateObj);
                    const updateValues = Object.values(updateObj);

                    const setClause = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
                    const whereClause = filterKeys.map((k, i) => `${k} = $${updateKeys.length + i + 1}`).join(' AND ');

                    const res = await pool.query(`UPDATE users SET ${setClause} WHERE ${whereClause}`, [...updateValues, ...filterValues]);
                    return res.rowCount;
                }
            }),
            select: async () => {
                const res = await pool.query(`SELECT * FROM users`);
                return res.rows;
            },
            insert: async (newRecord) => {
                const keys = Object.keys(newRecord);
                const values = Object.values(newRecord);
                const cols = keys.join(', ');
                const params = keys.map((_, i) => `$${i + 1}`).join(', ');
                const updateSets = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');
                const res = await pool.query(`
                    INSERT INTO users (${cols}) VALUES (${params}) 
                    ON CONFLICT (discord_id) DO UPDATE SET ${updateSets}
                    RETURNING *
                `, values);
                return res.rows;
            }
        };
    }

    if (tableName === 'followed_players') {
        return {
            join: (table, col1, col2) => ({
                whereNotNull: (notNullCol) => ({
                    select: async (...cols) => {
                        const res = await pool.query(`
                            SELECT followed_players.riot_id, users.discord_channel_id, users.discord_id, users.notify_mentions, users.notify_rankup_only, users.show_rank_wheel, users.language 
                            FROM followed_players 
                            JOIN users ON users.id = followed_players.user_id 
                            WHERE users.discord_channel_id IS NOT NULL
                        `);
                        return res.rows;
                    }
                })
            }),
            where: (filter) => ({
                first: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM followed_players WHERE ${whereClause} LIMIT 1`, values);
                    return res.rows[0] || null;
                },
                select: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM followed_players WHERE ${whereClause}`, values);
                    return res.rows;
                },
                del: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`DELETE FROM followed_players WHERE ${whereClause}`, values);
                    return res.rowCount;
                }
            }),
            select: async () => {
                const res = await pool.query(`SELECT * FROM followed_players`);
                return res.rows;
            },
            insert: async (newRecord) => {
                const keys = Object.keys(newRecord);
                const values = Object.values(newRecord);
                const cols = keys.join(', ');
                const params = keys.map((_, i) => `$${i + 1}`).join(', ');
                const res = await pool.query(`INSERT INTO followed_players (${cols}) VALUES (${params}) RETURNING *`, values);
                return res.rows;
            }
        };
    }

    if (tableName === 'bot_memory') {
        return {
            where: (filter) => ({
                first: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM bot_memory WHERE ${whereClause} LIMIT 1`, values);
                    return res.rows[0] || null;
                },
                update: async (updateObj) => {
                    const res = await pool.query(`UPDATE bot_memory SET last_match_id = $1 WHERE riot_id = $2`, [updateObj.last_match_id, filter.riot_id]);
                    return res.rowCount;
                }
            }),
            insert: async (newRecord) => {
                const res = await pool.query(`
                    INSERT INTO bot_memory (riot_id, last_match_id) 
                    VALUES ($1, $2) 
                    ON CONFLICT (riot_id) DO UPDATE SET last_match_id = EXCLUDED.last_match_id
                `, [newRecord.riot_id, newRecord.last_match_id]);
                return res.rows;
            }
        };
    }

    if (tableName === 'wishlist') {
        return {
            where: (filter) => ({
                first: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM wishlist WHERE ${whereClause} LIMIT 1`, values);
                    return res.rows[0] || null;
                },
                select: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM wishlist WHERE ${whereClause} ORDER BY created_at DESC`, values);
                    return res.rows;
                },
                del: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`DELETE FROM wishlist WHERE ${whereClause}`, values);
                    return res.rowCount;
                }
            }),
            select: async () => {
                const res = await pool.query(`SELECT * FROM wishlist`);
                return res.rows;
            },
            insert: async (newRecord) => {
                const keys = Object.keys(newRecord);
                const values = Object.values(newRecord);
                const cols = keys.join(', ');
                const params = keys.map((_, i) => `$${i + 1}`).join(', ');
                const res = await pool.query(`
                    INSERT INTO wishlist (${cols}) VALUES (${params}) 
                    ON CONFLICT (discord_id, skin_uuid) DO NOTHING
                    RETURNING *
                `, values);
                return res.rows;
            }
        };
    }

    if (tableName === 'bot_analytics') {
        return {
            where: (filter) => ({
                first: async () => {
                    const keys = Object.keys(filter);
                    const values = Object.values(filter);
                    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
                    const res = await pool.query(`SELECT * FROM bot_analytics WHERE ${whereClause} LIMIT 1`, values);
                    return res.rows[0] || null;
                },
                update: async (updateObj) => {
                    const filterKeys = Object.keys(filter);
                    const filterValues = Object.values(filter);
                    const updateKeys = Object.keys(updateObj);
                    const updateValues = Object.values(updateObj);
                    const setClause = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
                    const whereClause = filterKeys.map((k, i) => `${k} = $${updateKeys.length + i + 1}`).join(' AND ');
                    const res = await pool.query(`UPDATE bot_analytics SET ${setClause} WHERE ${whereClause}`, [...updateValues, ...filterValues]);
                    return res.rowCount;
                }
            }),
            select: async () => {
                const res = await pool.query(`SELECT * FROM bot_analytics`);
                return res.rows;
            },
            insert: async (newRecord) => {
                const keys = Object.keys(newRecord);
                const values = Object.values(newRecord);
                const cols = keys.join(', ');
                const params = keys.map((_, i) => `$${i + 1}`).join(', ');
                const updateSets = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');
                const res = await pool.query(`
                    INSERT INTO bot_analytics (${cols}) VALUES (${params}) 
                    ON CONFLICT (key) DO UPDATE SET ${updateSets}
                    RETURNING *
                `, values);
                return res.rows;
            }
        };
    }

    return {
        where: () => ({ first: async () => null, select: async () => [], update: async () => 0, del: async () => 0 }),
        select: async () => [],
        insert: async () => []
    };
}

module.exports = { knex, pool };
