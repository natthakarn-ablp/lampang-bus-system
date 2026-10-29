CREATE TABLE `meeting_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`topic` text NOT NULL,
	`role` text DEFAULT 'ไม่ระบุบทบาท' NOT NULL,
	`reporter` text DEFAULT 'ไม่ระบุชื่อ' NOT NULL,
	`issue` text DEFAULT '' NOT NULL,
	`proposal` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`conclusion` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'รอพิจารณา' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
