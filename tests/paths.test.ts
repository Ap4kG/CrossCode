import { describe, expect, test } from "bun:test";
import { isWindowsPath, joinPath, separatorFor } from "../src/utilities/paths";

describe("isWindowsPath", () => {
  test("detects drive letters", () => {
    expect(isWindowsPath("C:\\Users\\ap4k\\project")).toBe(true);
    expect(isWindowsPath("D:/Games/project")).toBe(true);
  });

  test("rejects POSIX and WSL paths", () => {
    expect(isWindowsPath("/mnt/c/Users/ap4k/project")).toBe(false);
    expect(isWindowsPath("/home/ap4k/project")).toBe(false);
  });
});

describe("separatorFor", () => {
  test("follows the style of the root", () => {
    expect(separatorFor("C:\\project")).toBe("\\");
    expect(separatorFor("C:/project")).toBe("/");
    expect(separatorFor("/mnt/c/project")).toBe("/");
  });
});

describe("joinPath", () => {
  test("joins POSIX paths", () => {
    expect(joinPath("/mnt/c/project", "Sources/App.swift")).toBe(
      "/mnt/c/project/Sources/App.swift"
    );
  });

  test("joins Windows paths with backslashes", () => {
    expect(joinPath("C:\\project", "Sources/App.swift")).toBe(
      "C:\\project\\Sources\\App.swift"
    );
  });

  test("ignores trailing and leading separators", () => {
    expect(joinPath("/mnt/c/project/", "/Sources/App.swift")).toBe(
      "/mnt/c/project/Sources/App.swift"
    );
  });

  test("keeps the root when the relative path is empty", () => {
    expect(joinPath("C:\\project\\", "")).toBe("C:\\project");
  });
});
