import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const userState = sqliteTable('user_state', {id:text('id').primaryKey(),payload:text('payload').notNull(),version:integer('version').notNull().default(0)});
export const refreshLeases = sqliteTable('refresh_leases', {id:text('id').primaryKey(),expiresAt:integer('expires_at').notNull()});
// Public product characteristics and discovery indexes; no user settings or keys.
export const referenceCache = sqliteTable('reference_cache', {id:text('id').primaryKey(),payload:text('payload').notNull(),expiresAt:integer('expires_at').notNull()});
export const statePayloadParts = sqliteTable('state_payload_parts', {id:text('id').primaryKey(),owner:text('owner').notNull(),payload:text('payload').notNull(),createdAt:integer('created_at').notNull()});
