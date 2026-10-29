ALTER TABLE `meeting_entries` ADD `tested_work` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `device_browser` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_entries` ADD `test_result` text DEFAULT 'ยังไม่ได้ตรวจ' NOT NULL;