import type { DatabaseSync } from "node:sqlite";
import type { OrchestratorConfig } from "./controller-types.ts";
import { reconcileCiRepairAttempts } from "./reconcile-ci-repair.ts";
import { reconcileReviewFixRounds } from "./reconcile-review-fix.ts";
import { reconcileAiReviews } from "./reconcile-ai-review.ts";
import { ensureControlEvents, reconcileProgressCards } from "./reconcile-progress.ts";

export type ControllerReconcilers = {
  ciRepair: (database: DatabaseSync) => void;
  reviewFix: (database: DatabaseSync) => void;
  aiReview: (database: DatabaseSync) => void;
  controlEvents: (database: DatabaseSync) => void;
  progressCards: (database: DatabaseSync, config: OrchestratorConfig) => void;
};

const productionReconcilers: ControllerReconcilers = {
  ciRepair: reconcileCiRepairAttempts,
  reviewFix: reconcileReviewFixRounds,
  aiReview: reconcileAiReviews,
  controlEvents: ensureControlEvents,
  progressCards: reconcileProgressCards,
};

export function reconcileBeforePlanning(
  database: DatabaseSync,
  config: OrchestratorConfig,
  reconcilers: ControllerReconcilers = productionReconcilers,
): void {
  reconcilers.ciRepair(database);
  reconcilers.reviewFix(database);
  reconcilers.aiReview(database);
  reconcilers.controlEvents(database);
  reconcilers.progressCards(database, config);
}

export function reconcileAfterAppliedAction(
  database: DatabaseSync,
  config: OrchestratorConfig,
  reconcilers: ControllerReconcilers = productionReconcilers,
): void {
  reconcilers.ciRepair(database);
  reconcilers.reviewFix(database);
  reconcilers.progressCards(database, config);
  reconcilers.controlEvents(database);
}

export function reconcileAfterCycle(
  database: DatabaseSync,
  config: OrchestratorConfig,
  reconcilers: ControllerReconcilers = productionReconcilers,
): void {
  reconcilers.controlEvents(database);
  reconcilers.progressCards(database, config);
}
