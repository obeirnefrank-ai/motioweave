import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  driverId: text('driver_id').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('push_driver_idx').on(table.driverId)]);

export const adminAudit = sqliteTable('admin_audit', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  driverId: text('driver_id').notNull(),
  beforeJson: text('before_json').notNull(),
  afterJson: text('after_json').notNull(),
  recordedAt: text('recorded_at').notNull(),
});

export const driverInvites = sqliteTable('driver_invites', {
  tokenHash: text('token_hash').primaryKey(),
  driverId: text('driver_id').notNull(),
  phoneNumber: text('phone_number').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  redeemedAt: text('redeemed_at'),
}, table => [index('idx_driver_invites_driver_id').on(table.driverId)]);
