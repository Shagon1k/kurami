import type { RunRow } from "./run-read-model.ts";

const projectDiscoveryMaxAgeMs = 2 * 60 * 1_000;

export function projectDiscoveryFresh(run: RunRow, now = Date.now()): boolean {
  if (run.project_poll_last_attempt_state !== "succeeded") return false;
  if (!run.project_poll_last_captured_at) return false;
  const capturedAt = Date.parse(run.project_poll_last_captured_at);
  return (
    Number.isFinite(capturedAt) &&
    capturedAt <= now &&
    now - capturedAt <= projectDiscoveryMaxAgeMs
  );
}

export function previewExpired(run: RunRow, now = Date.now()): boolean {
  if (run.preview_lease_state !== "running" || !run.preview_expires_at) return false;
  const expiresAt = Date.parse(run.preview_expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function previewEvidenceCurrent(run: RunRow): boolean {
  return (
    run.preview_required === 1 &&
    run.preview_requirement_satisfied_at !== null &&
    run.preview_requirement_lease_id !== null &&
    run.preview_requirement_verified_head_sha !== null &&
    run.ci_head_sha !== null &&
    run.preview_requirement_verified_head_sha === run.ci_head_sha
  );
}

export function previewRequirementSatisfied(run: RunRow): boolean {
  return run.completion_requested_at !== null && previewEvidenceCurrent(run);
}

export function previewCompletionOwnershipStable(
  state: string,
  ownerState: string,
): boolean {
  return (
    (state === "parked_review" && ownerState === "none") ||
    (state === "remote_owned" && ownerState === "remote")
  );
}
