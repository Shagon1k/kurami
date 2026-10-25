/** Correlated projections require the outer runs alias `r`; callers retain joins and filters. */
export const LATEST_ATTENTION_VALUE_SQL = `(SELECT reason FROM run_state_history attention_latest
  WHERE attention_latest.run_id = r.run_id AND attention_latest.to_state = 'needs_attention'
    AND attention_latest.reason NOT IN ('review_fix_task_archived', 'ci_repair_task_archived', 'preview_slot_leased', 'preview_slot_released')
  ORDER BY attention_latest.sequence DESC LIMIT 1)`;
export const LATEST_ATTENTION_SQL = `${LATEST_ATTENTION_VALUE_SQL} AS latest_attention_reason`;
export const LATEST_SUCCESSOR_STATE_SQL = `(SELECT succession_state FROM run_autonomous_successions successor_latest
  WHERE successor_latest.run_id = r.run_id
  ORDER BY successor_latest.succession_number DESC LIMIT 1) AS latest_autonomous_successor_state`;
export const LATEST_SUCCESSOR_THREAD_SQL = `(SELECT predecessor_thread_id FROM run_autonomous_successions successor_latest
  WHERE successor_latest.run_id = r.run_id
  ORDER BY successor_latest.succession_number DESC LIMIT 1) AS latest_autonomous_successor_predecessor_thread_id`;
export const ACTIVE_SUCCESSOR_COUNT_VALUE_SQL = `(SELECT COUNT(*) FROM run_autonomous_successions successor_active
  WHERE successor_active.run_id = r.run_id AND successor_active.succession_state IN ('starting','running'))`;
export const ACTIVE_SUCCESSOR_COUNT_SQL = `${ACTIVE_SUCCESSOR_COUNT_VALUE_SQL} AS autonomous_successor_active`;
export const ACTIVE_SUCCESSOR_EXISTS_SQL = `EXISTS (SELECT 1 FROM run_autonomous_successions successor_active
  WHERE successor_active.run_id = r.run_id AND successor_active.succession_state IN ('starting','running')) AS autonomous_successor_active`;
