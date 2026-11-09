-- Preserve the owner's request meaning independently of later ownership changes.
ALTER TABLE run_control_requests ADD COLUMN expected_predecessor_thread_id TEXT;
-- NULL intentionally leaves legacy requests without successor authorization.
ALTER TABLE run_control_requests ADD COLUMN owner_intent TEXT
  CHECK (owner_intent IN ('handoff', 'autonomous_successor'));
ALTER TABLE run_control_requests ADD COLUMN implementation_approved INTEGER NOT NULL DEFAULT 0
  CHECK (implementation_approved IN (0, 1));
