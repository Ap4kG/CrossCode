export const MAX_RECENT_FILES = 25;

/**
 * Moves `file` to the front of the recently opened list, de-duplicating by
 * exact path. The list is only used for ordering in the quick-open palette, so
 * entries that no longer exist simply never match anything.
 */
export function addRecentFile(existing: string[], file: string): string[] {
  if (!file) return existing;
  const others = existing.filter((entry) => entry !== file);
  return [file, ...others].slice(0, MAX_RECENT_FILES);
}
