CREATE TABLE `driver_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`driver_id` text NOT NULL,
	`phone_number` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`redeemed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_driver_invites_driver_id` ON `driver_invites` (`driver_id`);