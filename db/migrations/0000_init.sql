CREATE TABLE `fellowships` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`color_dark` text NOT NULL,
	`website` text,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_health` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`checked_at` text NOT NULL,
	`http_status` integer,
	`verdict` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meeting_sources` (
	`meeting_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_key` text NOT NULL,
	`raw_hash` text NOT NULL,
	`raw_json` text,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`source_id`, `source_key`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meeting_sources_meeting` ON `meeting_sources` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`fellowship` text NOT NULL,
	`name` text NOT NULL,
	`day` integer,
	`time` text,
	`end_time` text,
	`timezone` text NOT NULL,
	`tz_confidence` text DEFAULT 'source' NOT NULL,
	`rrule` text,
	`types_json` text DEFAULT '[]' NOT NULL,
	`conference_url` text,
	`conference_url_notes` text,
	`conference_phone` text,
	`conference_phone_notes` text,
	`conference_provider` text,
	`link_kind` text DEFAULT '?' NOT NULL,
	`notes` text,
	`group_name` text,
	`group_notes` text,
	`url` text,
	`language` text DEFAULT 'en',
	`formatted_address` text,
	`latitude` real,
	`longitude` real,
	`region` text,
	`approximate` text,
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`fellowship`) REFERENCES `fellowships`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_slug_unique` ON `meetings` (`slug`);--> statement-breakpoint
CREATE INDEX `meetings_status_day_time` ON `meetings` (`status`,`day`,`time`);--> statement-breakpoint
CREATE INDEX `meetings_fellowship_status` ON `meetings` (`fellowship`,`status`);--> statement-breakpoint
CREATE TABLE `overrides` (
	`meeting_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`reason` text,
	`author` text DEFAULT 'owner' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`meeting_id`, `field`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`fellowship` text NOT NULL,
	`adapter` text NOT NULL,
	`url` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`cadence_hours` integer DEFAULT 168 NOT NULL,
	`default_tz` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_run_at` text,
	`last_success_at` text,
	FOREIGN KEY (`fellowship`) REFERENCES `fellowships`(`code`) ON UPDATE no action ON DELETE no action
);
