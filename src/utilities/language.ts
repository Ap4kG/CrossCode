// Minimal extension -> Monaco language id mapping for the diff viewer. It only
// needs to cover what people actually edit in a Swift project.

const LANGUAGES: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  m: "objective-c",
  mm: "objective-c",
  plist: "xml",
  py: "python",
  rb: "ruby",
  sh: "shell",
  strings: "plaintext",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

export const PLAINTEXT_LANGUAGE = "plaintext";

/** Returns the Monaco language id for a file path, or `plaintext`. */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return PLAINTEXT_LANGUAGE;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? PLAINTEXT_LANGUAGE;
}
