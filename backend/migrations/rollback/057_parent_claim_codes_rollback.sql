-- Rollback for 057: drops the one-time bind-code table (no other table refers to it).
DROP TABLE IF EXISTS parent_claim_codes;
