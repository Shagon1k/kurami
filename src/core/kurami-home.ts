import { resolve } from "node:path";

export type KuramiHomeEnvironment = {
  KURAMI_HOME?: string;
};

export function resolveKuramiHome(
  fallback: string,
  environment: KuramiHomeEnvironment = process.env,
): string {
  if (environment.KURAMI_HOME !== undefined) {
    return resolve(environment.KURAMI_HOME);
  }
  return resolve(fallback);
}
