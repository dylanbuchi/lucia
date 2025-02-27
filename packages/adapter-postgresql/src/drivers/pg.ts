import {
	helper,
	getSetArgs,
	escapeName,
	transformDatabaseSession
} from "../utils.js";

import type { DatabaseSession } from "../utils.js";
import type { Adapter, InitializeAdapter, UserSchema, KeySchema } from "lucia";
import type {
	QueryResult,
	DatabaseError,
	Pool,
	PoolClient,
	QueryResultRow
} from "pg";

export const pgAdapter = (
	pool: Pool,
	tables: {
		user: string;
		session: string | null;
		key: string;
	}
): InitializeAdapter<Adapter> => {
	const transaction = async (
		execute: (connection: PoolClient) => Promise<any>
	): Promise<void> => {
		const connection = await pool.connect();
		try {
			await connection.query("BEGIN");
			await execute(connection);
			await connection.query("COMMIT");
		} catch (e) {
			connection.query("ROLLBACK");
			throw e;
		}
	};

	const ESCAPED_USER_TABLE_NAME = escapeName(tables.user);
	const ESCAPED_SESSION_TABLE_NAME = tables.session ? escapeName(tables.session): null;
	const ESCAPED_KEY_TABLE_NAME = escapeName(tables.key);

	return (LuciaError) => {
		return {
			getUser: async (userId) => {
				const result = await get<UserSchema>(
					pool.query(`SELECT * FROM ${ESCAPED_USER_TABLE_NAME} WHERE id = $1`, [
						userId
					])
				);
				return result;
			},
			setUser: async (user, key) => {
				if (!key) {
					const [userFields, userValues, userArgs] = helper(user);
					await pool.query(
						`INSERT INTO ${ESCAPED_USER_TABLE_NAME} ( ${userFields} ) VALUES ( ${userValues} )`,
						userArgs
					);
					return;
				}
				try {
					await transaction(async (tx) => {
						const [userFields, userValues, userArgs] = helper(user);
						await tx.query(
							`INSERT INTO ${ESCAPED_USER_TABLE_NAME} ( ${userFields} ) VALUES ( ${userValues} )`,
							userArgs
						);
						const [keyFields, keyValues, keyArgs] = helper(key);
						await tx.query(
							`INSERT INTO ${ESCAPED_KEY_TABLE_NAME} ( ${keyFields} ) VALUES ( ${keyValues} )`,
							keyArgs
						);
					});
				} catch (e) {
					const error = e as Partial<DatabaseError>;
					if (error.code === "23505" && error.detail?.includes("Key (id)")) {
						throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
					}
					throw e;
				}
			},
			deleteUser: async (userId) => {
				await pool.query(
					`DELETE FROM ${ESCAPED_USER_TABLE_NAME} WHERE id = $1`,
					[userId]
				);
			},
			updateUser: async (userId, partialUser) => {
				const [fields, values, args] = helper(partialUser);
				await pool.query(
					`UPDATE ${ESCAPED_USER_TABLE_NAME} SET ${getSetArgs(
						fields,
						values
					)} WHERE id = $${fields.length + 1}`,
					[...args, userId]
				);
			},

			getSession: async (sessionId) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				const result = await get<DatabaseSession>(
					pool.query(
						`SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
						[sessionId]
					)
				);
				return result ? transformDatabaseSession(result) : null;
			},
			getSessionsByUserId: async (userId) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				const result = await getAll<DatabaseSession>(
					pool.query(
						`SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE user_id = $1`,
						[userId]
					)
				);
				return result.map((val) => transformDatabaseSession(val));
			},
			setSession: async (session) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				try {
					const [fields, values, args] = helper(session);
					await pool.query(
						`INSERT INTO ${ESCAPED_SESSION_TABLE_NAME} ( ${fields} ) VALUES ( ${values} )`,
						args
					);
				} catch (e) {
					const error = e as Partial<DatabaseError>;
					if (
						error.code === "23503" &&
						error.detail?.includes("Key (user_id)")
					) {
						throw new LuciaError("AUTH_INVALID_USER_ID");
					}
					throw e;
				}
			},
			deleteSession: async (sessionId) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				await pool.query(
					`DELETE FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
					[sessionId]
				);
			},
			deleteSessionsByUserId: async (userId) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				await pool.query(
					`DELETE FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE user_id = $1`,
					[userId]
				);
			},
			updateSession: async (sessionId, partialSession) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				const [fields, values, args] = helper(partialSession);
				await pool.query(
					`UPDATE ${ESCAPED_SESSION_TABLE_NAME} SET ${getSetArgs(
						fields,
						values
					)} WHERE id = $${fields.length + 1}`,
					[...args, sessionId]
				);
			},

			getKey: async (keyId) => {
				const result = await get(
					pool.query<KeySchema>(
						`SELECT * FROM ${ESCAPED_KEY_TABLE_NAME} WHERE id = $1`,
						[keyId]
					)
				);
				return result;
			},
			getKeysByUserId: async (userId) => {
				const result = getAll<KeySchema>(
					pool.query(
						`SELECT * FROM ${ESCAPED_KEY_TABLE_NAME} WHERE user_id = $1`,
						[userId]
					)
				);
				return result;
			},
			setKey: async (key) => {
				try {
					const [fields, values, args] = helper(key);
					await pool.query(
						`INSERT INTO ${ESCAPED_KEY_TABLE_NAME} ( ${fields} ) VALUES ( ${values} )`,
						args
					);
				} catch (e) {
					const error = e as Partial<DatabaseError>;
					if (
						error.code === "23503" &&
						error.detail?.includes("Key (user_id)")
					) {
						throw new LuciaError("AUTH_INVALID_USER_ID");
					}
					if (error.code === "23505" && error.detail?.includes("Key (id)")) {
						throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
					}
					throw e;
				}
			},
			deleteKey: async (keyId) => {
				await pool.query(
					`DELETE FROM ${ESCAPED_KEY_TABLE_NAME} WHERE id = $1`,
					[keyId]
				);
			},
			deleteKeysByUserId: async (userId) => {
				await pool.query(
					`DELETE FROM ${ESCAPED_KEY_TABLE_NAME} WHERE user_id = $1`,
					[userId]
				);
			},
			updateKey: async (keyId, partialKey) => {
				const [fields, values, args] = helper(partialKey);
				await pool.query(
					`UPDATE ${ESCAPED_KEY_TABLE_NAME} SET ${getSetArgs(
						fields,
						values
					)} WHERE id = $${fields.length + 1}`,
					[...args, keyId]
				);
			},

			getSessionAndUser: async (sessionId) => {
				if (!ESCAPED_SESSION_TABLE_NAME) {
					throw new Error("Session table not defined");
				}
				const getSessionPromise = get(
					pool.query<DatabaseSession>(
						`SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
						[sessionId]
					)
				);
				const getUserFromJoinPromise = get(
					pool.query<
						UserSchema & {
							__session_id: string;
						}
					>(
						`SELECT ${ESCAPED_USER_TABLE_NAME}.*, ${ESCAPED_SESSION_TABLE_NAME}.id as __session_id FROM ${ESCAPED_SESSION_TABLE_NAME} INNER JOIN ${ESCAPED_USER_TABLE_NAME} ON ${ESCAPED_USER_TABLE_NAME}.id = ${ESCAPED_SESSION_TABLE_NAME}.user_id WHERE ${ESCAPED_SESSION_TABLE_NAME}.id = $1`,
						[sessionId]
					)
				);
				const [sessionResult, userFromJoinResult] = await Promise.all([
					getSessionPromise,
					getUserFromJoinPromise
				]);
				if (!sessionResult || !userFromJoinResult) return [null, null];
				const { __session_id: _, ...userResult } = userFromJoinResult;
				return [transformDatabaseSession(sessionResult), userResult];
			}
		};
	};
};

export const get = async <_Schema extends QueryResultRow>(
	queryPromise: Promise<QueryResult<_Schema>>
): Promise<_Schema | null> => {
	const { rows } = await queryPromise;
	const result = rows.at(0) ?? null;
	return result;
};

export const getAll = async <_Schema extends QueryResultRow>(
	queryPromise: Promise<QueryResult<_Schema>>
): Promise<_Schema[]> => {
	const { rows } = await queryPromise;
	return rows;
};
