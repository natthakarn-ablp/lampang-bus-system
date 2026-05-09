-- Add research_phase to daily_snapshots for distinguishing research baselines
ALTER TABLE daily_snapshots
  ADD COLUMN research_phase VARCHAR(50) NULL AFTER run_type;

-- Index for filtering by research_phase
ALTER TABLE daily_snapshots
  ADD INDEX idx_research_phase (research_phase);
