import { resolve } from "node:path";

export type KuramiHomeEnvironment = {
  KURAMI_HOME?: string;
  ORCHESTRATOR_HOME?: string;
};

export type LegacyHomeWarning = (message: string) => void;

const legacyWarningMessage =
  "ORCHESTRATOR_HOME is deprecated; set KURAMI_HOME instead. " +
  "Compatibility fallback remains active during the migration window.";
let legacyWarningEmitted = false;

function warnLegacyHomeOnce(message: string): void {
  if (legacyWarningEmitted) return;
  legacyWarningEmitted = true;
  process.emitWarning(message, {
    code: "KURAMI_LEGACY_HOME",
    type: "DeprecationWarning",
  });
}

export function resolveKuramiHome(
  fallback: string,
  environment: KuramiHomeEnvironment = process.env,
  warnLegacyHome: LegacyHomeWarning = warnLegacyHomeOnce,
): string {
  if (environment.KURAMI_HOME !== undefined) {
    return resolve(environment.KURAMI_HOME);
  }
  if (environment.ORCHESTRATOR_HOME !== undefined) {
    warnLegacyHome(legacyWarningMessage);
    return resolve(environment.ORCHESTRATOR_HOME);
  }
  return resolve(fallback);
}
