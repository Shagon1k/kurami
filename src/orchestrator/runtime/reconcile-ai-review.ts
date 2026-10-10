import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { removeReviewSnapshot } from "../projects/reviews/snapshot.ts";
import type { DatabaseSync } from "node:sqlite";

function tmuxSessionAlive(name: string): boolean {
  if (!/^rv-[a-z0-9-]+$/u.test(name)) return false;
  const result = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

export function reconcileAiReviews(database: DatabaseSync): void {
  const reviews = database
    .prepare(
      `SELECT review_id, tmux_session_name, created_at
       FROM run_ai_reviews`,
    )
    .all() as Array<{
    review_id: string;
    tmux_session_name: string;
    created_at: string;
  }>;
  for (const review of reviews) {
    const ageSeconds = (Date.now() - Date.parse(review.created_at)) / 1_000;
    if (ageSeconds < 15 || tmuxSessionAlive(review.tmux_session_name)) continue;
    database
      .prepare(
        `UPDATE run_ai_reviews
         SET review_state='failed',
             failure_reason='AI review worker exited before recording a result',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE review_id=? AND review_state='running'`,
      )
      .run(review.review_id);
    const location = database.location("main");
    if (location && /^air_[a-f0-9]+$/u.test(review.review_id))
      removeReviewSnapshot(resolve(location, "../.."), review.review_id);
  }
}
