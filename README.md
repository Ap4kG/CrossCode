<img align="left" width="120" height="120" src="/logo.png">

<div id="user-content-toc">
  <ul style="list-style: none;">
    <summary>
      <h1>CrossCode</h1>
    </summary>
  </ul>
</div>

---

[![Build CrossCode](https://github.com/Ap4kG/CrossCode/actions/workflows/build.yml/badge.svg)](https://github.com/Ap4kG/CrossCode/actions/workflows/build.yml)

iOS Swift development IDE for Windows/Linux. Create, build, and test apps without owning a Mac.

Supports Swift 6.2 and the Swift Package Manager.

> This is a fork of [nab138/CrossCode](https://github.com/nab138/CrossCode) maintained by [Ap4kG](https://github.com/Ap4kG).
> See [This fork](#this-fork) for what changed and how updates work.

### Demo

https://github.com/user-attachments/assets/9cbe2b71-d765-46c6-aa25-ef16b539deec

## This fork

- **Beta status.** The project is in beta: it is usable end to end (build, sign, install, run on a real iPhone with a free Apple ID), but expect rough edges.
- **Own identity.** Bundle identifier `me.ap4k.crosscode`, so it installs alongside the upstream build and keeps its own settings.
- **Own update channel.** Releases are published here and the updater points at this repository, so upstream releases are ignored.
- **Apple ID sign-in fixes.**
  - Apple now rejects the legacy `com.apple.dt.Xcode/...` client info with `503 + HTML` (shown as `PlistError(<html>)`); the fork sends a current client info instead.
  - The legacy `ani.sidestore.io` anisette server now makes Apple answer `-80045 This action cannot be completed`. The default is `mac-ani.jkcoxson.com`, and the anisette server setting is actually honored now.
  - A failed anisette refresh no longer panics during sign-in or while waiting for the 2FA code.

## Installation

CrossCode is currently in beta. Expect bugs — and please report them to this fork's [issue tracker](https://github.com/Ap4kG/CrossCode/issues).

Download the latest build for your platform from [releases](https://github.com/Ap4kG/CrossCode/releases/latest).

Check out the [Getting Started](https://github.com/nab138/CrossCode/wiki#getting-started) section of the [wiki](https://github.com/nab138/CrossCode/wiki). Also, see [Troubleshooting](https://github.com/nab138/CrossCode/wiki/Troubleshooting) and [FAQ](https://github.com/nab138/CrossCode/wiki/FAQ)

## Features

- Generate a Darwin SDK for linux from a user provided copy of Xcode 26 to build the apps
- Build apps using swift package manager
- Log in with your Apple ID to sign apps
- Install apps on device
- Create projects from templates
- Code editing including error reporting, autocomplete, go to definition, and other language features
- Quick open files with `Ctrl+P` (recently opened files first, `file:42` to jump to a line, `#query` to search file contents), draggable editor tabs, and optional auto save
- Built-in Git panel with branch status, staged/unstaged changes, side-by-side diffs, stage/unstage (single file or all), amend and commit
- Device setup check: verifies the USB connection, the developer disk image and iOS 16+ Developer Mode, and mounts the image for you
- Recent projects on the welcome screen
- Light/dark mode and other customizations
- View and manage certificates, app IDs, and more
- View the syslog or the stdout (console) of your device/app
- Much more (and more to come!)

## Future plans

The app is currently functional but does not have all the features it should. You can see a tentative plan for the future [on trello](https://trello.com/b/QYQFfOvm/ycode)

Please note that I am one person, so development may be slow. If you want to help, PRs welcome!

## How it works

- A darwin SDK is generated from a user provided copy of Xcode 26 (extracted with [unxip-rs](https://github.com/nab138/unxip-rs)) and darwin tools from [darwin-tools-linux-llvm](https://github.com/xtool-org/darwin-tools-linux-llvm)
- Swift uses the darwin SDK to build an executable which is packaged into an .app bundle.
- The code to sign and install apps onto a device has been removed from CrossCode's source and moved to a standalone package, [isideload](https://github.com/nab138/isideload). It was built on a lot of other libraries, so check out its README for more info.

## Credits

- [idevice](https://github.com/jkcoxson/idevice) is used to communicate with iOS devices.
- [xtool](https://xtool.sh) has been used as a reference for the implementation of the darwin SDK generation.
- [Sideloader](https://github.com/Dadoum/Sideloader) has been heavily used as a reference for the implementation of the Apple Developer APIs and sideloading process.
- [GNU cpio](https://www.gnu.org/software/cpio/) 2.14 is included under GPLv3 (see licenses/GPL-3.0.txt), with its copyright holders. See [Source code](https://ftp.gnu.org/gnu/cpio/cpio-2.14.tar.gz). It is used to help with XIP extraction.

### AI Usage

- Helped port small sections of code from [Sideloader](https://github.com/Dadoum/Sideloader) because I'm not familiar with dlang syntax

## Architecture

CrossCode is a Tauri 2 application with a React/TypeScript frontend and a Rust backend.

- `src/` — the UI. `pages/` contains the welcome screen, project creation, and the IDE; `components/` contains the editor, file explorer, menus, console and the quick-open palette; `preferences/` is a small registry-driven settings framework; `utilities/` holds shared contexts, LSP wiring, the Tauri filesystem provider and pure helpers.
- `src-tauri/src/` — native logic exposed as Tauri commands:
  - `builder/` — Darwin SDK generation, Swift/SwiftPM builds and `.app`/`.ipa` packaging.
  - `sideloader/` — Apple Developer APIs, device communication, signing, syslog/stdout streaming.
  - `sourcekit_lsp.rs`, `lsp_utils.rs` — SourceKit-LSP lifecycle and project validation.
  - `windows.rs`, `builder/crossplatform.rs` — WSL path handling and command execution.
  - `git.rs` - Git integration used by the bottom panel (status, diffs, staging, commit/amend, before/after file contents).
  - `search.rs` - project-wide content search used by the quick-open palette.
- `src-tauri/templates/` — starter projects used by the "New Project" flow.
- `src-tauri/vendor/nab138_icloud_auth/` — patched copy of the Apple authentication crate: it forces a current anisette client info and no longer panics when an anisette refresh fails. Remove it from the `[patch.crates-io]` section once the upstream crate ships the same fixes.
- `sdkmover/` — helper crate that moves a generated SDK inside WSL.

The editor is Monaco (the VS Code editor core) with the VS Code language/theme/textmate services, so most editor features live in `components/Tiles/Editor.tsx`.

## Development

Prerequisites:

- [Rust](https://rustup.rs/) stable (with `rustfmt` and `clippy`)
- [Bun](https://bun.sh/) and Node.js 20+
- Linux: the Tauri system dependencies (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`)
- Windows: WSL2 is required to build iOS apps (not needed to work on the UI)

```bash
bun install
bun run tauri dev   # run the app with hot reload
```

Useful checks (also run in CI):

```bash
bun run typecheck                 # tsc --noEmit
bun run lint                      # Biome (lint only; formatting is left to the editor)
bun test                          # frontend unit tests (bun:test)
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Biome only runs the linter (`biome.json` keeps `formatter.enabled` off) so it does not reformat the
tree; a few rules are disabled where the existing code intentionally uses the pattern (ANSI HTML in
the console, non-focusable drag containers, promise wrappers around async setup). CI also runs
`cargo audit` and Dependabot keeps npm/cargo/GitHub Actions dependencies up to date.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

