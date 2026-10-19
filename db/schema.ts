import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const userState = sqliteTable('user_state', {id:text('id').primaryKey(),payload:text('payload').notNull(),version:integer('version').notNull().default(0)});
export const refreshLeases = sqliteTable('refresh_leases', {id:text('id').primaryKey(),expiresAt:integer('expires_at').notNull()});
