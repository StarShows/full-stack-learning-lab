CREATE TABLE `user_progress` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `scope`)
);
