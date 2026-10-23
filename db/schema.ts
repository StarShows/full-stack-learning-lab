import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const progress = sqliteTable('user_progress', {
  userId: text('user_id').notNull(),
  scope: text('scope').notNull(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({columns: [table.userId, table.scope]})]);
