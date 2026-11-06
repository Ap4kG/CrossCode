import { describe, expect, test } from "bun:test";
import { matchSegments, parseQuery } from "../src/utilities/fileSearch";
import { languageForPath, PLAINTEXT_LANGUAGE } from "../src/utilities/language";

describe("parseQuery", () => {
  test("defaults to file mode", () => {
    expect(parseQuery("ContentView")).toEqual({
      mode: "file",
      text: "ContentView",
    });
  });

  test("trims whitespace", () => {
    expect(parseQuery("  App.swift  ")).toEqual({
      mode: "file",
      text: "App.swift",
    });
  });

  test("switches to content mode on #", () => {
    expect(parseQuery("#viewDidLoad")).toEqual({
      mode: "content",
      text: "viewDidLoad",
    });
  });

  test("parses a line suffix", () => {
    expect(parseQuery("App.swift:42")).toEqual({
      mode: "file",
      text: "App.swift",
      line: 42,
    });
  });

  test("treats a single letter before the colon as a drive letter", () => {
    expect(parseQuery("C:42")).toEqual({ mode: "file", text: "C:42" });
  });

  test("does not parse a line in content mode", () => {
    expect(parseQuery("#foo:12")).toEqual({ mode: "content", text: "foo:12" });
  });
});

describe("matchSegments", () => {
  test("returns a single plain segment for an empty query", () => {
    expect(matchSegments("App.swift", "")).toEqual([
      { text: "App.swift", match: false },
    ]);
  });

  test("marks matched characters and merges neighbours", () => {
    const segments = matchSegments("ContentView.swift", "cv");
    expect(segments).toEqual([
      { text: "C", match: true },
      { text: "ontent", match: false },
      { text: "V", match: true },
      { text: "iew.swift", match: false },
    ]);
  });

  test("returns the whole text unhighlighted when it does not match", () => {
    expect(matchSegments("App.swift", "zzz")).toEqual([
      { text: "App.swift", match: false },
    ]);
  });
});

describe("languageForPath", () => {
  test("maps known extensions case-insensitively", () => {
    expect(languageForPath("Sources/App.SWIFT")).toBe("swift");
    expect(languageForPath("a\\b\\main.ts")).toBe("typescript");
  });

  test("falls back to plaintext", () => {
    expect(languageForPath("Package")).toBe(PLAINTEXT_LANGUAGE);
    expect(languageForPath("file.unknownext")).toBe(PLAINTEXT_LANGUAGE);
    expect(languageForPath("trailing.")).toBe(PLAINTEXT_LANGUAGE);
  });
});
