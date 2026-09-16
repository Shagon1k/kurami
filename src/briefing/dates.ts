/** Advance a civil date, not an instant: DST does not change this operation. */
export function nextLocalDate(date: string): string {
  const instant = new Date(date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0,10)!==date) {
    throw new Error("Invalid local date");
  }
  return new Date(instant.getTime()+86_400_000).toISOString().slice(0,10);
}
