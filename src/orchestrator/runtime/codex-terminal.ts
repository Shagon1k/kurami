export function transcriptWaitingOnApproval(transcript: string): boolean {
  return /Would you like to run|Requested permission|Press enter to confirm|Allow .+\?/iu.test(
    transcript.slice(-1_500),
  );
}

export function transcriptBusy(transcript: string): boolean {
  return /Working \(|esc to interrupt|Booting MCP server/iu.test(
    transcript.slice(-700),
  );
}

export function transcriptHasIdlePrompt(transcript: string): boolean {
  return /(?:^|\n)›[^\n]*(?:\n|$)/u.test(transcript.slice(-1_500));
}

export function transcriptHasCompletedTurn(transcript: string): boolean {
  const tail = transcript.slice(-4_000);
  const completed =
    /Worked for[^\n]*\nToken usage:[^\n]*\nTo continue this session, run codex resume [a-f0-9-]{16,}/iu.test(
      tail,
    ) ||
    /(?:^|\n)\s*─+\s*Worked for[^\n]*─+\s*\n[\s\S]*?^\s*› Ask Codex to do anything\b/imu.test(
      tail,
    );
  return completed && !transcriptWaitingOnApproval(tail) && !transcriptBusy(tail);
}
