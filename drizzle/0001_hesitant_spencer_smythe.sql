CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`driver_id` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`recorded_at` text NOT NULL
);
