export type DiscordObject = Record<string, unknown>;

export const discordComponentsV2Flag = 1 << 15;

export function textDisplay(content: string): DiscordObject {
  return { type: 10, content };
}

export function separator(spacing: 1 | 2 = 1): DiscordObject {
  return { type: 14, divider: true, spacing };
}

export function container(
  components: DiscordObject[],
  accentColor?: number,
): DiscordObject {
  return {
    type: 17,
    components,
    ...(accentColor === undefined ? {} : { accent_color: accentColor }),
  };
}

export function actionRow(components: DiscordObject[]): DiscordObject {
  return { type: 1, components };
}

export function button(
  label: string,
  style: number,
  customId?: string,
  url?: string,
): DiscordObject {
  return {
    type: 2,
    style,
    label,
    ...(customId ? { custom_id: customId } : {}),
    ...(url ? { url } : {}),
  };
}

export type SelectOption = {
  label: string;
  value: string;
  description?: string;
  emoji?: { name: string };
};

export function stringSelect(
  customId: string,
  placeholder: string,
  options: SelectOption[],
): DiscordObject {
  return {
    type: 3,
    custom_id: customId,
    placeholder,
    min_values: 1,
    max_values: 1,
    options,
  };
}

export function componentMessage(
  components: DiscordObject[],
  extras: DiscordObject = {},
): DiscordObject {
  return {
    flags: discordComponentsV2Flag,
    components,
    allowed_mentions: { parse: [] },
    ...extras,
  };
}

export function compactTable(rows: Array<[string, string]>): string {
  const labelWidth = 12;
  const valueWidth = 24;
  return [
    "```text",
    ...rows.map(
      ([label, value]) =>
        `${label.slice(0, labelWidth).padEnd(labelWidth)}  ${value.slice(0, valueWidth).padEnd(valueWidth)}`,
    ),
    "```",
  ].join("\n");
}

export function compactMatrix(
  rows: Array<[string, string, string, string]>,
): string {
  const labelWidth = 10;
  const valueWidth = 4;
  return [
    "```text",
    ...rows.map(([leftLabel, leftValue, rightLabel, rightValue]) =>
      [
        leftLabel.slice(0, labelWidth).padEnd(labelWidth),
        leftValue.slice(0, valueWidth).padStart(valueWidth),
        "   ",
        rightLabel.slice(0, labelWidth).padEnd(labelWidth),
        rightValue.slice(0, valueWidth).padStart(valueWidth),
      ].join(" "),
    ),
    "```",
  ].join("\n");
}
