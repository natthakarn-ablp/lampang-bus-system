ALTER TABLE `meeting_entries` ADD `form_version` text DEFAULT 'legacy-v8' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participation_choices` text DEFAULT '' NOT NULL;