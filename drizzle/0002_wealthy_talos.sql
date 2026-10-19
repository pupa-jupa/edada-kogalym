CREATE TABLE `state_payload_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
