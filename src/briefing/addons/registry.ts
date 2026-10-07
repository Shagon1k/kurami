import type { BriefingAddonEnvelope, BriefingPayload } from "../model.ts";
import { calendarAddon } from "./calendar.ts";
import { cinemaAddon } from "./cinema.ts";
import { mailAddon } from "./mail.ts";
import { newsAddon } from "./news.ts";
import type {
  BriefingAddon,
  BriefingAddonSlot,
  OrderedMetricCard,
} from "./types.ts";
import { weatherAddon } from "./weather.ts";
import { signalsAddon } from "./signals.ts";
import {weeklyAddon} from "./weekly.ts";
import {stocksAddon} from "./stocks.ts";
import {engineeringAddon} from "./engineering.ts";

export const BRIEFING_ADDONS: readonly BriefingAddon[] = Object.freeze([
  mailAddon,
  calendarAddon,
  newsAddon,
  weatherAddon,
  cinemaAddon,
  signalsAddon,
  weeklyAddon,
  stocksAddon,
  engineeringAddon,
]);

const ADDON_ID = /^[a-z][a-z0-9-]{0,63}$/u;

export function collectAddonQuality(payload: BriefingPayload, addons = BRIEFING_ADDONS) {
  return enabledAddons(payload, addons)
    .flatMap(addon => addon.quality ? [{ id: addon.id, ...addon.quality }] : [])
    .sort((left, right) => left.order - right.order)
    .map(quality => ({ id: quality.id, label: quality.label, state: quality.state(payload) }));
}

function validOrder(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`Invalid ${label} order: ${String(value)}`);
  }
  return value;
}

function enabledAddons(
  payload: BriefingPayload,
  addons: readonly BriefingAddon[],
): BriefingAddon[] {
  const seen = new Set<string>();
  return addons.filter((addon) => {
    if (!ADDON_ID.test(addon.id) || seen.has(addon.id)) {
      throw new Error(`Invalid or duplicate briefing add-on ID: ${addon.id || "<empty>"}`);
    }
    seen.add(addon.id);
    try {
      return addon.enabled(payload);
    } catch (error) {
      if (addon.failurePolicy === "propagate") throw error;
      return false;
    }
  });
}

function isolated<T>(
  addon: BriefingAddon,
  operation: () => T,
  fallback: (error: unknown) => T | null,
): T | null {
  try {
    return operation();
  } catch (error) {
    if (addon.failurePolicy === "propagate") throw error;
    try {
      return fallback(error);
    } catch {
      return null;
    }
  }
}

export function renderAddonSlot(
  payload: BriefingPayload,
  slot: BriefingAddonSlot,
  addons: readonly BriefingAddon[] = BRIEFING_ADDONS,
): string {
  return enabledAddons(payload, addons)
    .flatMap((addon) => (addon.sections ?? [])
      .filter((section) => section.slot === slot)
      .map((section) => ({ addon, section: { ...section, order: validOrder(section.order, `${addon.id} section`) } })))
    .sort((left, right) => left.section.order - right.section.order
      || left.addon.id.localeCompare(right.addon.id))
    .map(({ addon, section }) => isolated(
      addon,
      () => section.render(payload),
      (error) => addon.renderFailure?.(error, slot) ?? null,
    ))
    .filter((html): html is string => typeof html === "string" && html.length > 0)
    .join("\n      ");
}

export function collectAddonMetrics(
  payload: BriefingPayload,
  addons: readonly BriefingAddon[] = BRIEFING_ADDONS,
): OrderedMetricCard[] {
  return enabledAddons(payload, addons)
    .flatMap((addon) => (addon.metrics ?? []).map((metric) => ({
      addon,
      metric: { ...metric, order: validOrder(metric.order, `${addon.id} metric`) },
    })))
    .map(({ addon, metric }) => isolated(
      addon,
      () => ({ addonId: addon.id, order: metric.order, card: metric.build(payload) }),
      () => null,
    ))
    .filter((value): value is OrderedMetricCard => value !== null)
    .sort((left, right) => left.order - right.order || left.addonId.localeCompare(right.addonId));
}

export function captureAddonManifest(
  payload: BriefingPayload,
  addons: readonly BriefingAddon[] = BRIEFING_ADDONS,
): Record<string, BriefingAddonEnvelope> {
  return Object.fromEntries(enabledAddons(payload, addons)
    .map((addon) => {
      if (!addon.capture) return null;
      const envelope = isolated(addon, () => addon.capture!(payload), () => null);
      return envelope ? [addon.id, envelope] as const : null;
    })
    .filter((entry): entry is readonly [string, BriefingAddonEnvelope] => entry !== null));
}
