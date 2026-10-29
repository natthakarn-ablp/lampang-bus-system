ALTER TABLE `meeting_entries` ADD `stakeholder_group` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_problem_definition` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_data_review` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_system_trial` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_decision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_implementation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participated_followup` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `education_benefit_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `transport_benefit_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `network_benefit_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `participation_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `research_use_acknowledged` integer DEFAULT 0 NOT NULL;