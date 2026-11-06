import { describe, expect, test } from "bun:test";
import { addRecentFile, MAX_RECENT_FILES } from "../src/utilities/recentFiles";

describe("addRecentFile", () => {
  test("puts the newest file first", () => {
    expect(addRecentFile(["/a.swift"], "/b.swift")).toEqual([
      "/b.swift",
      "/a.swift",
    ]);
  });

  test("de-duplicates the same path", () => {
    expect(addRecentFile(["/a.swift", "/b.swift"], "/b.swift")).toEqual([
      "/b.swift",
      "/a.swift",
    ]);
  });

  test("ignores empty paths", () => {
    expect(addRecentFile(["/a.swift"], "")).toEqual(["/a.swift"]);
  });

  test("caps the list length", () => {
    const existing = Array.from(
      { length: MAX_RECENT_FILES },
      (_, index) => `/file-${index}.swift`
    );
    const result = addRecentFile(existing, "/new.swift");
    expect(result).toHaveLength(MAX_RECENT_FILES);
    expect(result[0]).toBe("/new.swift");
  });
});
