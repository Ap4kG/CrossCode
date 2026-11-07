/**
 * Builds the `latest.json` manifest consumed by the in-app updater.
 *
 * Usage:
 *   bun scripts/latest-json.ts --version 0.1.5 --notes "0.1.5 Beta - ..." \
 *     --dir src-tauri/target/release/bundle [--tag v0.1.5] [--repo Ap4kG/CrossCode]
 *
 * The manifest is uploaded next to the installers in the GitHub release, and the
 * app fetches it from `releases/latest/download/latest.json`.
 *
 * Supported platforms:
 *   windows-x86_64  CrossCode_<version>_x64-setup.exe        (+ .exe.sig)
 *   linux-x86_64    CrossCode_<version>_amd64.AppImage.tar.gz (+ .tar.gz.sig)
 *                   or a bare .AppImage with a sibling .AppImage.sig
 */
import fs from "node:fs";
import path from "node:path";

interface Args {
  version?: string;
  notes?: string;
  dir: string[];
  tag?: string;
  repo: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: [], repo: "Ap4kG/CrossCode" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--version":
        args.version = next();
        break;
      case "--notes":
        args.notes = next();
        break;
      case "--dir":
        args.dir.push(next());
        break;
      case "--tag":
        args.tag = next();
        break;
      case "--repo":
        args.repo = next();
        break;
      case "--out":
        args.out = next();
        break;
      case "--help":
        console.log(fs.readFileSync(import.meta.path, "utf8").split("*/")[0]);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.version) throw new Error("--version is required");
  if (args.dir.length === 0) throw new Error("--dir is required");
  return args;
}

/** Every file in the given directories, keyed by name. */
function collectFiles(dirs: string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of dirs) {
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.set(entry.name, full);
      }
    };
    if (fs.existsSync(dir)) walk(dir);
  }
  return files;
}

function readSignature(files: Map<string, string>, artifact: string): string | null {
  for (const candidate of [`${artifact}.sig`, artifact.replace(/\.tar\.gz$/, "") + ".sig"]) {
    const file = files.get(candidate);
    if (file) return fs.readFileSync(file, "utf8").trim();
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
const tag = args.tag ?? `v${args.version}`;
const files = collectFiles(args.dir);
const base = `https://github.com/${args.repo}/releases/download/${tag}`;

const platforms: Record<string, { signature: string; url: string }> = {};

const windows = [...files.keys()].find(
  (name) => name.endsWith("_x64-setup.exe") && name.includes(args.version!)
);
if (windows) {
  const signature = readSignature(files, windows);
  if (signature) {
    platforms["windows-x86_64"] = { signature, url: `${base}/${encodeURIComponent(windows)}` };
  } else {
    console.warn(`skip ${windows}: no signature found`);
  }
}

const linuxTar =
  [...files.keys()].find(
    (name) => name.endsWith("_amd64.AppImage.tar.gz") && name.includes(args.version!)
  ) ?? [...files.keys()].find((name) => name.endsWith("_amd64.AppImage") && name.includes(args.version!));
if (linuxTar) {
  const signature = readSignature(files, linuxTar);
  if (signature) {
    platforms["linux-x86_64"] = { signature, url: `${base}/${encodeURIComponent(linuxTar)}` };
  } else {
    console.warn(`skip ${linuxTar}: no signature found`);
  }
}

if (Object.keys(platforms).length === 0) {
  throw new Error("No signed artifacts found. Build one first, or pass the right --dir.");
}

const manifest = {
  version: args.version,
  notes: args.notes ?? `${args.version} Beta`,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms,
};

const out = args.out ?? path.join(args.dir[0], "latest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2), "utf8");
console.log(`wrote ${out}`);
console.log(JSON.stringify(manifest, null, 2));
