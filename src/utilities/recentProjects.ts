export type RecentProject = {
  path: string;
  name: string;
  openedAt: number;
};

export const MAX_RECENT_PROJECTS = 8;

/** Moves a project to the top of the list, de-duplicating by path. */
export function addRecentProject(
  existing: RecentProject[],
  project: RecentProject
): RecentProject[] {
  const others = existing.filter((entry) => entry.path !== project.path);
  return [project, ...others].slice(0, MAX_RECENT_PROJECTS);
}

export function removeRecentProject(
  existing: RecentProject[],
  projectPath: string
): RecentProject[] {
  return existing.filter((entry) => entry.path !== projectPath);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Compact "2 hours ago" style label used on the welcome screen. */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now()
): string {
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (elapsed < WEEK) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  if (elapsed < 4 * WEEK) {
    const weeks = Math.floor(elapsed / WEEK);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
