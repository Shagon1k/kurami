/**
 * Return the original title from a provider's `Localized (Original)` value.
 * Walking backwards from the final parenthesis preserves an original title
 * which itself contains parentheses. A single available title is unchanged.
 */
export function originalTitleFromBilingual(value: string): string {
  const title = value.replace(/\s+/gu, " ").trim();
  if (!title.endsWith(")")) return title;
  let depth = 0;
  for (let index = title.length - 1; index >= 0; index -= 1) {
    if (title[index] === ")") depth += 1;
    else if (title[index] === "(") {
      depth -= 1;
      if (depth === 0) {
        const original = title.slice(index + 1, -1).trim();
        const localized = title.slice(0, index).trim();
        return original && localized ? original : title;
      }
    }
  }
  return title;
}
