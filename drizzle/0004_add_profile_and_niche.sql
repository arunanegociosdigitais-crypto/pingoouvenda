CREATE TABLE `business_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`niche` text DEFAULT '' NOT NULL,
	`niche_custom` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `niche` text DEFAULT '' NOT NULL;
