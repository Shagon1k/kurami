export type ChartUnit =
  | { kind: "number"; suffix?: string }
  | { kind: "percent" }
  | { kind: "currency"; currency: string };
export type ChartCategory = { key: string; label: string; shortLabel?: string; partial?: boolean };
export type ChartSeries = { id: string; label: string; values: Array<number | null> };
export type ChartSpec = {
  version: 1; id: string; kind: "trend" | "bar"; title: string; description?: string;
  xLabel: string; yLabel: string; unit: ChartUnit;
  categories: ChartCategory[]; series: ChartSeries[];
  baseline?: "zero" | "auto"; initialWindow?: number;
  state?: "ready" | "partial" | "unavailable"; message?: string;
};
export type ChartInput = Omit<ChartSpec, "version" | "kind">;
