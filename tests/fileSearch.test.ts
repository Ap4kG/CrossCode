import { describe, expect, test } from "bun:test";
import {
  filterFiles,
  fuzzyScore,
  isBinaryFile,
  relativePath,
  shouldIgnoreDirectory,
} from "../src/utilities/fileSearch";

describe("fuzzyScore", () => {
  test("matches a subsequence", () => {
    expect(fuzzyScore("cnt", "ContentView.swift")).not.toBeNull();
  });

  test("rejects characters that are out of order", () => {
    expect(fuzzyScore("tnc", "ContentView.swift")).toBeNull();
  });

  test("prefers path-boundary matches", () => {
    const boundary = fuzzyScore("cv", "Sources/ContentView.swift");
    const middle = fuzzyScore("cv", "Sources/ActivityView.swift");
    expect(boundary).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(boundary!).toBeGreaterThan(middle!);
  });

  test("empty query matches everything with a neutral score", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("relativePath", () => {
  test("handles POSIX separators", () => {
    expect(relativePath("/project", "/project/Sources/App.swift")).toBe(
      "Sources/App.swift"
    );
  });

  test("handles Windows separators and trailing separators", () => {
    expect(
      relativePath("C:\\project\\", "C:\\project\\Sources\\App.swift")
    ).toBe("Sources\\App.swift");
  });

  test("leaves unrelated paths untouched", () => {
    expect(relativePath("/project", "/other/App.swift")).toBe("/other/App.swift");
  });
});

describe("project index filters", () => {
  test("ignores known build and metadata directories", () => {
    expect(shouldIgnoreDirectory(".build")).toBe(true);
    expect(shouldIgnoreDirectory("node_modules")).toBe(true);
    expect(shouldIgnoreDirectory("Sources")).toBe(false);
  });

  test("detects binary files case-insensitively", () => {
    expect(isBinaryFile("AppIcon.PNG")).toBe(true);
    expect(isBinaryFile("ContentView.swift")).toBe(false);
    expect(isBinaryFile("Makefile")).toBe(false);
  });
});

describe("filterFiles", () => {
  const files = [
    "/project/Sources/ContentView.swift",
    "/project/Sources/App.swift",
    "/project/Tests/ContentViewTests.swift",
  ];

  test("returns all files for an empty query", () => {
    expect(filterFiles(files, "")).toHaveLength(3);
  });

  test("ranks matches and drops non-matches", () => {
    const result = filterFiles(files, "content", "/project");
    expect(result[0]).toBe("/project/Sources/ContentView.swift");
    expect(result).toContain("/project/Tests/ContentViewTests.swift");
    expect(result).not.toContain("/project/Sources/App.swift");
  });

  test("sorts alphabetically and honours recently opened files", () => {
    const result = filterFiles(
      files,
      "",
      "/project",
      50,
      ["/mnt/c/project/Tests/ContentViewTests.swift"]
    );
    expect(result[0]).toBe("/project/Tests/ContentViewTests.swift");
    expect(result.slice(1)).toEqual([
      "/project/Sources/App.swift",
      "/project/Sources/ContentView.swift",
    ]);
  });

  test("rejects queries longer than the target", () => {
    expect(fuzzyScore("contentviewswift", "App.swift")).toBeNull();
  });

  test("respects the result limit", () => {
    expect(filterFiles(files, "", "/project", 1)).toHaveLength(1);
  });
});
