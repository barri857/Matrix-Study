CREATE TABLE `kits` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	`share_id` text,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kits_share_id_unique` ON `kits` (`share_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
