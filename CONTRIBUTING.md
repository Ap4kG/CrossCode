# Contributing to CrossCode

Thanks for helping out! CrossCode is a small project, so a focused PR is much
easier to review than a large one.

## Getting started

1. Fork and clone the repository.
2. Install Bun, Node.js 20+ and a stable Rust toolchain (with `rustfmt` and
   `clippy`).
3. Install the Tauri system dependencies for your platform (see the
   [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)). On Linux
   that is `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` and
   `patchelf`.
4. `bun install`
5. `bun run tauri dev`

You do **not** need Xcode or a Mac to work on the UI. Xcode is only needed at
runtime to generate the Darwin SDK and build iOS apps.

## Before opening a pull request

Run the same checks as CI:

```bash
bun run typecheck
bun test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Keep the following in mind:

- Match the style of the surrounding code (formatting, naming, component
  structure). `cargo fmt` is required for Rust changes.
- Keep Tauri command names, argument names and payload shapes in sync between
  `src-tauri/src/*` and the `invoke(...)` calls in `src/`.
- Prefer extending the existing preference registry
  (`src/preferences/`) over adding one-off settings.
- Pure helpers belong in `src/utilities/` (or a small Rust module) with a
  matching `*.test.ts` / `#[cfg(test)]` where practical. UI-only changes do not
  need tests.
- Add a short entry to the PR description explaining the user-visible effect,
  and include screenshots/GIFs for UI changes.
- Do not commit generated artifacts (`dist/`, `src-tauri/target/`,
  `node_modules/`).

## Reporting bugs

Use the bug report template and include:

- OS and CrossCode version
- Whether WSL2 is in use (Windows)
- Swift toolchain and Darwin SDK versions
- Steps to reproduce and any relevant logs from the console or devtools

## Feature requests

Open an issue with the feature request template. Describe the problem first,
then the proposed solution. Big features (debugger, git integration, ...) are
best discussed in an issue before implementation.

## License

By contributing you agree that your changes are licensed under the same
license as the project (see [LICENSE](LICENSE)).
