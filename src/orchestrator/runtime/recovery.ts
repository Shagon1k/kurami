export const autonomousSuccessorStartFailedReason =
  "autonomous_successor_start_failed";

export type RecoverySnapshot = {
  runState: string;
  ownerState: string;
  executionMode: string;
  resourceState: string;
  worktreePath: string | null;
  branchName: string | null;
  tmuxSessionName: string | null;
  codexThreadId: string | null;
  previousCodexThreadId: string | null;
  latestAttentionReason: string | null;
  latestSuccessorState: string | null;
  latestSuccessorPredecessorThreadId: string | null;
  autonomousSuccessorActive: number;
};

export function isNeedsAttentionCliHandoff(
  run: RecoverySnapshot,
): boolean {
  return (
    run.runState === "needs_attention" &&
    run.ownerState === "cli" &&
    run.executionMode === "live" &&
    run.resourceState === "provisioned" &&
    run.tmuxSessionName !== null &&
    run.codexThreadId !== null &&
    run.previousCodexThreadId === null
  );
}

export function isFailedAutonomousSuccessorRecovery(
  run: RecoverySnapshot,
): boolean {
  return (
    run.runState === "needs_attention" &&
    run.ownerState === "none" &&
    run.executionMode === "live" &&
    run.resourceState === "provisioned" &&
    run.worktreePath !== null &&
    run.branchName !== null &&
    run.tmuxSessionName === null &&
    run.codexThreadId !== null &&
    run.previousCodexThreadId === null &&
    // Older failed-successor records predate the durable attention-reason field.
    // Their failed successor row still proves the same bounded recovery case.
    (run.latestAttentionReason === null ||
      run.latestAttentionReason === autonomousSuccessorStartFailedReason) &&
    run.latestSuccessorState === "failed" &&
    run.latestSuccessorPredecessorThreadId === run.codexThreadId &&
    run.autonomousSuccessorActive === 0
  );
}
