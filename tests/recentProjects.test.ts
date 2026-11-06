import { describe, expect, test } from "bun:test";
import {
  addRecentProject,
  formatRelativeTime,
  MAX_RECENT_PROJECTS,
  removeRecentProject,
  type RecentProject,
} from "../src/utilities/recentProjects";

function project(path: string, openedAt = 0): RecentProject {
  return { path, name: path.split("/").pop() ?? path, openedAt };
}

describe("addRecentProject", () => {
  test("adds new projects to the front", () => {
    const result = addRecentProject([project("/a")], project("/b", 1));
    expect(result.map((entry) => entry.path)).toEqual(["/b", "/a"]);
  });

  test("de-duplicates existing projects and refreshes their timestamp", () => {
    const result = addRecentProject(
      [project("/a", 1), project("/b", 2)],
      project("/a", 3)
    );
    expect(result.map((entry) => entry.path)).toEqual(["/a", "/b"]);
    expect(result[0].openedAt).toBe(3);
  });

  test("caps the list length", () => {
    const existing = Array.from({ length: MAX_RECENT_PROJECTS }, (_, index) =>
      project(`/project-${index}`)
    );
    const result = addRecentProject(existing, project("/new"));
    expect(result).toHaveLength(MAX_RECENT_PROJECTS);
    expect(result[0].path).toBe("/new");
  });
});

describe("removeRecentProject", () => {
  test("removes only the requested project", () => {
    const result = removeRecentProject([project("/a"), project("/b")], "/a");
    expect(result.map((entry) => entry.path)).toEqual(["/b"]);
  });

  test("is a no-op for unknown paths", () => {
    expect(removeRecentProject([project("/a")], "/missing")).toHaveLength(1);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  test("describes very recent entries", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
  });

  test("describes minutes, hours and days", () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(formatRelativeTime(now - 90 * 60_000, now)).toBe("1 hour ago");
    expect(formatRelativeTime(now - 26 * 60 * 60_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe(
      "3 days ago"
    );
  });

  test("clamps timestamps in the future", () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });

  test("falls back to a date for old entries", () => {
    const label = formatRelativeTime(now - 365 * 24 * 60 * 60_000, now);
    expect(label).not.toContain("ago");
  });
});
