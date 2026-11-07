// TOML is not part of VS Code's built-in language set, so CrossCode ships its
// own TextMate grammar. It is registered the same way the Xcode themes are:
// as a tiny system extension with blob URLs for the grammar files.

import { registerExtension } from "@codingame/monaco-vscode-api/extensions";

const TOML_GRAMMAR = {
  name: "TOML",
  scopeName: "source.toml",
  fileTypes: ["toml"],
  patterns: [
    { include: "#comment" },
    { include: "#table" },
    { include: "#key" },
    { include: "#triple-double-string" },
    { include: "#triple-single-string" },
    { include: "#double-string" },
    { include: "#single-string" },
    { include: "#boolean" },
    { include: "#date-time" },
    { include: "#number" },
  ],
  repository: {
    comment: {
      match: "(#).*$",
      name: "comment.line.number-sign.toml",
      captures: {
        1: { name: "punctuation.definition.comment.toml" },
      },
    },
    table: {
      match: "^\\s*(\\[\\[?)([^\\]\\n]+)(\\]\\]?)",
      captures: {
        1: { name: "punctuation.definition.table.toml" },
        2: { name: "entity.name.type.toml" },
        3: { name: "punctuation.definition.table.toml" },
      },
    },
    key: {
      match:
        "^\\s*([A-Za-z0-9_.\\-]+|\"[^\"\\n]*\"|'[^'\\n]*')\\s*(?==)",
      captures: {
        1: { name: "support.type.property-name.toml" },
      },
    },
    "triple-double-string": {
      begin: '"""',
      end: '"""',
      name: "string.quoted.triple.toml",
    },
    "triple-single-string": {
      begin: "'''",
      end: "'''",
      name: "string.quoted.triple.toml",
    },
    "double-string": {
      match: '"(?:[^"\\\\]|\\\\.)*"',
      name: "string.quoted.double.toml",
    },
    "single-string": {
      match: "'(?:[^'\\\\]|\\\\.)*'",
      name: "string.quoted.single.toml",
    },
    boolean: {
      match: "\\b(true|false)\\b",
      name: "constant.language.boolean.toml",
    },
    "date-time": {
      match:
        "\\b\\d{4}-\\d{2}-\\d{2}(?:[Tt ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:\\d{2})?)?\\b",
      name: "constant.numeric.date-time.toml",
    },
    time: {
      match: "\\b\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?\\b",
      name: "constant.numeric.date-time.toml",
    },
    number: {
      match:
        "\\b(?:0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|[+-]?\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?|inf|nan)\\b",
      name: "constant.numeric.toml",
    },
  },
};

const TOML_CONFIGURATION = {
  comments: { lineComment: "#" },
  brackets: [
    ["[", "]"],
    ["{", "}"],
  ],
  autoClosingPairs: [
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] },
  ],
  surroundingPairs: [
    ["[", "]"],
    ["{", "}"],
    ['"', '"'],
    ["'", "'"],
  ],
};

let registration: Promise<void> | null = null;

function blobUrl(value: unknown): string {
  return URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" })
  );
}

export function registerTomlLanguage(): Promise<void> {
  if (registration) return registration;

  registration = (async () => {
    const extension = registerExtension(
      {
        name: "crosscode-toml",
        publisher: "crosscode",
        version: "1.0.0",
        engines: { vscode: "*" },
        contributes: {
          languages: [
            {
              id: "toml",
              aliases: ["TOML", "toml"],
              extensions: [".toml"],
              configuration: "./language-configuration.json",
            },
          ],
          grammars: [
            {
              language: "toml",
              scopeName: "source.toml",
              path: "./syntaxes/toml.tmLanguage.json",
            },
          ],
        },
      },
      undefined,
      { system: true }
    ) as unknown as {
      registerFileUrl: (
        path: string,
        url: string,
        metadata?: { mimeType?: string }
      ) => unknown;
      whenReady: () => Promise<void>;
    };

    extension.registerFileUrl(
      "./syntaxes/toml.tmLanguage.json",
      blobUrl(TOML_GRAMMAR),
      { mimeType: "application/json" }
    );
    extension.registerFileUrl(
      "./language-configuration.json",
      blobUrl(TOML_CONFIGURATION),
      { mimeType: "application/json" }
    );

    await extension.whenReady();
  })().catch((error) => {
    console.error("Failed to register the TOML language:", error);
    registration = null;
  });

  return registration;
}
