export type ChartUnit =
  | { kind: "number"; suffix?: string }
  | { kind: "percent" }
  | { kind: "currency"; currency: string };
export type ChartCategory = { key: string; label: string; shortLabel?: string; partial?: boolean };
export type ChartSeries = {
  id: string; label: string; values: Array<number | null>;
  color?: 1 | 2 | 3 | 4 | 5;
  partial?: boolean[];
};
export type ChartDisplay = {
  variant?: "card" | "embedded";
  density?: "regular" | "compact";
  header?: boolean;
  legend?: "interactive" | "static" | "hidden";
  zoom?: boolean;
  values?: boolean;
  table?: "disclosure" | "screen-reader";
};
export type ChartSpec = {
  version: 1; id: string; kind: "trend" | "bar"; title: string; description?: string;
  xLabel: string; yLabel: string; unit: ChartUnit;
  categories: ChartCategory[]; series: ChartSeries[];
  baseline?: "zero" | "auto"; initialWindow?: number;
  minimumMaximum?: number;
  display?: ChartDisplay;
  state?: "ready" | "partial" | "unavailable"; message?: string;
};
export type ChartInput = Omit<ChartSpec, "version" | "kind">;
