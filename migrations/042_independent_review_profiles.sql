-- Read-only reviewer profiles may queue and run independently on the same task.
DROP INDEX run_control_requests_one_pending_action_idx;
CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing') AND action <> 'ai_review';
CREATE UNIQUE INDEX run_control_requests_one_pending_review_profile_idx
  ON run_control_requests(run_id, review_profile)
  WHERE request_state IN ('pending', 'processing') AND action = 'ai_review';

DROP INDEX run_ai_reviews_one_running_idx;
CREATE UNIQUE INDEX run_ai_reviews_one_running_idx
  ON run_ai_reviews(run_id, review_profile)
  WHERE review_state = 'running';
