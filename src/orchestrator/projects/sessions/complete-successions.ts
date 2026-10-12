import type { DatabaseSync } from "node:sqlite";

export function completeSuccessions(database: DatabaseSync, runId: string): void {
  database.prepare(`
    UPDATE run_autonomous_successions
    SET succession_state='parked',
        completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE run_id=? AND succession_state IN ('starting','running') AND completed_at IS NULL
  `).run(runId);
}
