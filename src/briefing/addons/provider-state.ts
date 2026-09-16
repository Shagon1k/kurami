import type { SectionState } from "../model.ts";
import { providerIssue, type ProviderResult, type ProviderState } from "../providers/common.ts";

export function sectionState(value: ProviderState): SectionState {
  return value;
}

export function providerComplete<T>(result: ProviderResult<T>): result is ProviderResult<T> & { value: T } {
  return result.value !== null && (result.state === "ready" || result.state === "empty");
}


export function failedProviderResult<T>(error: unknown, fetchedAt: string, fallbackCode: string): ProviderResult<T> {
  return { state: "failed", value: null, fetchedAt, attempts: 0, issues: [providerIssue(error, fallbackCode)] };
}

export function aggregateProviderState(results: Array<ProviderResult<unknown>>): ProviderState {
  if (!results.length) return "empty";
  if (results.every(result => result.state === "failed")) return "failed";
  if (results.some(result => !providerComplete(result))) return "partial";
  return results.every(result => result.state === "empty") ? "empty" : "ready";
}
