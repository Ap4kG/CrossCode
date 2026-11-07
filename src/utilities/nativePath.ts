// Path conversions between the editor world (WSL paths such as `/mnt/c/...`)
// and the host file system (Windows paths such as `C:\...`).
//
// The Tauri `windows_path` / `linux_path` commands spawn `wsl.exe`, which takes
// hundreds of milliseconds. The common cases are pure string transformations,
// so they are handled here and the command is only used for exotic paths
// (e.g. `/home/...` or network shares).

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { isWindowsPath } from "./paths";

const WSL_MOUNT = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/;
// VS Code URIs expose Windows paths as `/c:/Users/...`.
const URI_DRIVE = /^\/([a-zA-Z]):(?:\/(.*))?$/;

/**
 * `/mnt/c/Users/me` or VS Code URI style `/c:/Users/me` -> `C:\Users\me`.
 * Returns null when the path is not a drive path.
 */
export function wslPathToWindows(value: string): string | null {
  const match = WSL_MOUNT.exec(value);
  if (match) {
    const drive = match[1].toUpperCase();
    const tail = (match[2] ?? "").replace(/\//g, "\\");
    return tail ? `${drive}:\\${tail}` : `${drive}:\\`;
  }

  const uriMatch = URI_DRIVE.exec(value);
  if (uriMatch) {
    const drive = uriMatch[1].toUpperCase();
    const tail = (uriMatch[2] ?? "").replace(/\//g, "\\");
    return tail ? `${drive}:\\${tail}` : `${drive}:\\`;
  }

  return null;
}

/** `C:\Users\me` -> `/mnt/c/Users/me`, or null when not a drive path. */
export function windowsPathToWsl(value: string): string | null {
  const match = /^([a-zA-Z]):[\\/]?(.*)$/.exec(value);
  if (!match) return null;

  const drive = match[1].toLowerCase();
  const tail = match[2].replace(/\\/g, "/").replace(/^\/+/, "");
  return tail ? `/mnt/${drive}/${tail}` : `/mnt/${drive}`;
}

/**
 * Synchronous best-effort conversion to a native (host) path. Returns the
 * input unchanged when no cheap conversion is possible.
 */
export function nativePathSync(value: string): string {
  if (platform() !== "windows") return value;
  if (isWindowsPath(value)) return value;
  return wslPathToWindows(value) ?? value;
}

/** Converts an editor path to a native path, falling back to the backend. */
export async function nativePath(value: string): Promise<string> {
  if (platform() !== "windows") return value;
  if (isWindowsPath(value)) return value;

  const fast = wslPathToWindows(value);
  if (fast) return fast;

  try {
    return await invoke<string>("windows_path", { path: value });
  } catch {
    return value;
  }
}

/** Converts a native path to the WSL path style the editor uses on Windows. */
export async function editorPath(value: string): Promise<string> {
  if (platform() !== "windows") return value;
  if (value.startsWith("/")) return value;

  const fast = windowsPathToWsl(value);
  if (fast) return fast;

  try {
    return await invoke<string>("linux_path", { path: value });
  } catch {
    return value;
  }
}
