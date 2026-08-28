import { classifyTranscript } from "../src/orchestrator/projects/sessions/observe.ts";
import * as canonicalObserver from "../src/orchestrator/projects/sessions/observe.ts";
import * as legacyObserver from "../src/orchestrator/projects/sessions/observe.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyObserver.classifyTranscript === canonicalObserver.classifyTranscript &&
    legacyObserver.runSessionObserverCli ===
      canonicalObserver.runSessionObserverCli,
  "Legacy session observer is not a transparent compatibility wrapper",
);

const blocker = `
Publishing is blocked because gh credentials are invalid.
Following the workflow, I stopped before staging or committing.
Re-authenticate with: gh auth login -h github.com

› Implement {feature}
`;
const transient = `
Publishing is blocked at the moment, so I am retrying the safe check.
• Working (12s • esc to interrupt)
`;
const approval = `
Would you like to run the following command?
Press enter to confirm or esc to cancel
`;

assert(
  classifyTranscript(blocker) === "idle_textual_blocker",
  "Idle textual blocker was not detected",
);
assert(
  classifyTranscript(transient) === null,
  "Transient blocker narration caused a false alert",
);
assert(
  classifyTranscript(approval) === "waiting_on_approval",
  "Approval prompt was not detected",
);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    idleTextualBlocker: true,
    transientIgnored: true,
    approvalDetected: true,
  })}\n`,
);
