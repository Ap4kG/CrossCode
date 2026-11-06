// Small path helpers shared by the git panel and the quick-open palette.
//
// Project paths in CrossCode are not necessarily in the host OS format: on
// Windows with WSL installed the project lives at e.g. `/mnt/c/Users/...`.
// `path.resolve` from the Tauri path plugin would use Windows semantics there,
// so we join strings ourselves and keep the separator style of the project
// root instead.

export function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** Separator used by `root`: backslash for `C:\...`, slash otherwise. */
export function separatorFor(root: string): "\\" | "/" {
  if (isWindowsPath(root) && root.includes("\\")) return "\\";
  return "/";
}

/**
 * Joins a project root with a repository-relative path such as `Sources/App.swift`,
 * keeping the separator style of `root`.
 */
export function joinPath(root: string, relative: string): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const trimmedRelative = relative.replace(/^[\\/]+/, "");
  const separator = separatorFor(root);
  const normalized = trimmedRelative.replace(/[\\/]+/g, separator);

  if (trimmedRoot === "") return separator + normalized;
  if (normalized === "") return trimmedRoot;
  return trimmedRoot + separator + normalized;
}
