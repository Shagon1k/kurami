export const WRITER_STOP_TEXT = {
  label: "Agent stopped",
  noPr: "No PR is available for review. Local work is preserved.",
  unknownPr: "The current PR commit is not known yet. Local work is preserved.",
  session: "Open session",
  report: "Run report",
  noReport: "No stop report was saved. Open the session for details.",
  noCi: "CI results are not available yet.",
  noEvidence: "CI and review results are not available yet.",
} as const;

export function writerStopPresentation(hasPr: boolean): { label: string; detail: string } {
  return { label: WRITER_STOP_TEXT.label, detail: hasPr ? WRITER_STOP_TEXT.unknownPr : WRITER_STOP_TEXT.noPr };
}
