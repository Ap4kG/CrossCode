// Lightweight symbol extraction used by the jump bar and "Go to Symbol".
//
// Monaco's document symbols come from SourceKit-LSP, which only speaks Swift
// and may be disabled (low RAM). This module is a pure, synchronous fallback
// that understands the declarations people actually navigate to. It is not a
// parser: false positives are filtered out by the patterns below.

export type SymbolKind =
  | "class"
  | "struct"
  | "enum"
  | "protocol"
  | "extension"
  | "function"
  | "property"
  | "typealias"
  | "case"
  | "import";

export interface FileSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line number. */
  line: number;
}

type Pattern = {
  regex: RegExp;
  kind: SymbolKind;
  /** Capture group holding the name. */
  group?: number;
};

const SWIFT_PATTERNS: Pattern[] = [
  { regex: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*import\s+([A-Za-z_][\w.]*)/, kind: "import" },
  {
    regex:
      /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|final|indirect)\s+)*(?:class|actor)\s+([A-Za-z_]\w*)/,
    kind: "class",
  },
  {
    regex:
      /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|final)\s+)*struct\s+([A-Za-z_]\w*)/,
    kind: "struct",
  },
  {
    regex:
      /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open)\s+)*enum\s+([A-Za-z_]\w*)/,
    kind: "enum",
  },
  {
    regex:
      /^\s*(?:(?:public|private|fileprivate|internal|open)\s+)*protocol\s+([A-Za-z_]\w*)/,
    kind: "protocol",
  },
  {
    regex: /^\s*(?:(?:public|private|fileprivate|internal|open)\s+)*extension\s+([\w.]+)/,
    kind: "extension",
  },
  { regex: /^\s*(?:(?:public|private|fileprivate|internal|open)\s+)*typealias\s+([A-Za-z_]\w*)/, kind: "typealias" },
  {
    regex:
      /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|static|class|override|mutating|nonmutating|final|required|convenience)\s+)*func\s+([A-Za-z_]\w*)/,
    kind: "function",
  },
  {
    regex:
      /^\s*(?:(?:public|private|fileprivate|internal|open|static|class|final)\s+)*(?:let|var)\s+([A-Za-z_]\w*)/,
    kind: "property",
  },
  { regex: /^\s*case\s+([A-Za-z_]\w*)/, kind: "case" },
];

const JS_PATTERNS: Pattern[] = [
  { regex: /^\s*import\b/, kind: "import", group: 0 },
  {
    regex:
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
  },
  { regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "protocol" },
  { regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "typealias" },
  { regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  {
    regex:
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    kind: "function",
  },
  { regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "property" },
];

const PYTHON_PATTERNS: Pattern[] = [
  { regex: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
  { regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
  { regex: /^([A-Z_][A-Z0-9_]*)\s*=/, kind: "property" },
];

const PYTHON_EXTENSIONS = new Set(["py"]);
const JS_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
]);

function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
}

function patternsFor(file: string): Pattern[] | null {
  const extension = extensionOf(file);
  if (extension === "swift") return SWIFT_PATTERNS;
  if (JS_EXTENSIONS.has(extension)) return JS_PATTERNS;
  if (PYTHON_EXTENSIONS.has(extension)) return PYTHON_PATTERNS;
  return null;
}

const MAX_SYMBOLS = 400;

/**
 * Extracts declarations from `text`, ordered by line. Returns an empty array
 * for languages without a pattern set.
 */
export function extractSymbols(file: string, text: string): FileSymbol[] {
  const patterns = patternsFor(file);
  if (!patterns) return [];

  const symbols: FileSymbol[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;

    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (!match) continue;

      const name = (pattern.group === 0 ? match[0] : match[1])?.trim();
      if (!name) continue;

      symbols.push({ name, kind: pattern.kind, line: index + 1 });
      break;
    }

    if (symbols.length >= MAX_SYMBOLS) break;
  }

  return symbols;
}

/** Single-character glyph shown before a symbol, similar to Xcode's list. */
export function symbolGlyph(kind: SymbolKind): string {
  switch (kind) {
    case "class":
      return "C";
    case "struct":
      return "S";
    case "enum":
      return "E";
    case "protocol":
      return "P";
    case "extension":
      return "X";
    case "function":
      return "ƒ";
    case "property":
      return "v";
    case "typealias":
      return "T";
    case "case":
      return "◇";
    case "import":
      return "↧";
    default:
      return "•";
  }
}
