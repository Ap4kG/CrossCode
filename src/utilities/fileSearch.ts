// Pure helpers used by the "Go to File" (Ctrl+P) palette.
// Kept free of Tauri/Monaco imports so they can be unit-tested with `bun test`.

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".build",
  ".crosscode",
  ".swiftpm",
  ".vscode",
  "DerivedData",
  "build",
  "node_modules",
]);

// Files that are never useful to open in a text editor and can make the
// project index crawl to a halt.
export const BINARY_EXTENSIONS = new Set([
  "a",
  "app",
  "avif",
  "bmp",
  "dylib",
  "heic",
  "heif",
  "ipa",
  "jpeg",
  "jpg",
  "gif",
  "ico",
  "icns",
  "o",
  "pdf",
  "png",
  "so",
  "tif",
  "tiff",
  "webp",
  "zip",
]);

/** Formats the editor can show in its image preview instead of a text model. */
export const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "icns",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function isImageFile(name: string): boolean {
  const extension = extensionOf(name);
  return extension !== null && IMAGE_EXTENSIONS.has(extension);
}

export function imageMimeType(name: string): string {
  switch (extensionOf(name)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "icns":
      return "image/icns";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

export function shouldIgnoreDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

export function isBinaryFile(name: string): boolean {
  const extension = extensionOf(name);
  return extension !== null && BINARY_EXTENSIONS.has(extension);
}

/**
 * Returns a relevance score for `query` inside `target`, or null when the
 * query is not a subsequence of the target. Higher is better.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  // A subsequence can never be longer than its target.
  if (query.length > target.length) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let best: number | null = null;

  // Try every possible starting point instead of greedily taking the first
  // match: "content" should rank "Sources/ContentView.swift" above a file
  // where the first 'c' happens to appear in "Sources".
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== q[0]) continue;

    let score = 0;
    let queryIndex = 0;
    let lastMatch = -2;

    for (let i = start; i < t.length && queryIndex < q.length; i++) {
      if (t[i] !== q[queryIndex]) continue;

      // Reward consecutive characters and matches at path boundaries.
      score += i === lastMatch + 1 ? 3 : 1;
      if (i === 0 || t[i - 1] === "/" || t[i - 1] === "\\") score += 2;

      lastMatch = i;
      queryIndex++;
    }

    if (queryIndex !== q.length) continue;

    // Prefer shorter paths when the score is otherwise equal.
    const candidate = score - t.length * 0.01;
    if (best === null || candidate > best) best = candidate;
  }

  return best;
}

/** Strips `root` from `file` so the palette can show a short relative path. */
export function relativePath(root: string, file: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (file === normalizedRoot) return "";
  if (
    file.startsWith(normalizedRoot + "/") ||
    file.startsWith(normalizedRoot + "\\")
  ) {
    return file.slice(normalizedRoot.length + 1);
  }
  return file;
}

/**
 * Filters and ranks project files for the quick-open palette.
 * Matching is performed against the path relative to `root`.
 *
 * With an empty query the palette lists the files the user opened most
 * recently first (in the order given by `recentFiles`) and everything else
 * alphabetically, so `Ctrl+P` alone behaves like a "recent files" list.
 */
export function filterFiles(
  files: string[],
  query: string,
  root = "",
  limit = 50,
  recentFiles: string[] = []
): string[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    // Recent entries may be recorded in a different path style than the files
    // produced by the project index (editor path vs. host path), so match by
    // relative path suffix instead of raw string equality.
    const recent = recentFiles
      .filter((file) => file.length > 0)
      .map((file) => file.replace(/\\/g, "/"));

    const rankOf = (file: string): number => {
      const relative = (root ? relativePath(root, file) : file).replace(
        /\\/g,
        "/"
      );
      for (let index = 0; index < recent.length; index++) {
        const candidate = recent[index];
        if (candidate === relative || candidate.endsWith("/" + relative)) {
          return index;
        }
      }
      return Number.MAX_SAFE_INTEGER;
    };

    return [...files]
      .sort((a, b) => {
        const rankA = rankOf(a);
        const rankB = rankOf(b);
        if (rankA !== rankB) return rankA - rankB;

        const relativeA = root ? relativePath(root, a) : a;
        const relativeB = root ? relativePath(root, b) : b;
        return relativeA.localeCompare(relativeB);
      })
      .slice(0, limit);
  }

  const ranked = files
    .map((file) => {
      const relative = root ? relativePath(root, file) : file;
      const score = fuzzyScore(trimmed, relative);
      if (score === null) return { file, score: null };

      // Matches in the file name itself are more useful than matches that are
      // only spread across directory names.
      const separator = Math.max(
        relative.lastIndexOf("/"),
        relative.lastIndexOf("\\")
      );
      const name = separator === -1 ? relative : relative.slice(separator + 1);
      const nameScore = fuzzyScore(trimmed, name);

      return {
        file,
        score: score + (nameScore !== null ? 100 + nameScore : 0),
      };
    })
    .filter(
      (entry): entry is { file: string; score: number } => entry.score !== null
    );

  ranked.sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  return ranked.map((entry) => entry.file).slice(0, limit);
}

export type PaletteQuery = {
  /** `content` is triggered by a leading `#`. */
  mode: "file" | "content";
  /** Query text without the mode prefix and without a `:line` suffix. */
  text: string;
  /** 1-based line to jump to, parsed from `file:42`. */
  line?: number;
};

const LINE_SUFFIX = /^(.*):(\d+)$/;

/**
 * Splits what the user typed in the quick-open palette into a mode, a search
 * text and an optional line number.
 */
export function parseQuery(raw: string): PaletteQuery {
  if (raw.startsWith("#")) {
    return { mode: "content", text: raw.slice(1).trim() };
  }

  const match = LINE_SUFFIX.exec(raw.trim());
  if (match) {
    const [, before, digits] = match;
    // `C:42` style paths must not be mistaken for a line suffix.
    if (before.length > 1 || !/^[A-Za-z]$/.test(before)) {
      return {
        mode: "file",
        text: before.trim(),
        line: Number.parseInt(digits, 10),
      };
    }
  }

  return { mode: "file", text: raw.trim() };
}

export type TextSegment = { text: string; match: boolean };

/**
 * Splits `text` into highlighted and plain segments for the subsequence match
 * produced by `fuzzyScore`, so the palette can show *why* a file matched.
 */
export function matchSegments(text: string, query: string): TextSegment[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();

  const indices = new Set<number>();
  let queryIndex = 0;

  for (let index = 0; index < text.length && queryIndex < lowerQuery.length; index++) {
    if (lowerText[index] === lowerQuery[queryIndex]) {
      indices.add(index);
      queryIndex++;
    }
  }

  if (queryIndex !== lowerQuery.length) return [{ text, match: false }];

  const segments: TextSegment[] = [];
  for (let index = 0; index < text.length; index++) {
    const match = indices.has(index);
    const last = segments[segments.length - 1];
    if (last && last.match === match) {
      last.text += text[index];
    } else {
      segments.push({ text: text[index], match });
    }
  }
  return segments;
}
