use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

/// Directories that never contain useful search results and can be huge.
const IGNORED_DIRECTORIES: &[&str] = &[
    ".build",
    ".crosscode",
    ".git",
    ".swiftpm",
    ".vscode",
    "DerivedData",
    "build",
    "node_modules",
];

/// Files larger than this are skipped: they are almost always generated or
/// binary and reading them just slows the search down.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

const MAX_TEXT_LENGTH: usize = 200;

const MAX_LIMIT: usize = 500;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

fn is_ignored(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|name| IGNORED_DIRECTORIES.contains(&name))
        .unwrap_or(false)
}

fn collect_hits(
    project_path: &str,
    limit: usize,
    matches: impl Fn(&str) -> bool,
) -> Vec<SearchHit> {
    let mut hits = Vec::new();

    for entry in WalkDir::new(project_path)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry))
        .flatten()
    {
        if hits.len() >= limit {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        if size > MAX_FILE_BYTES {
            continue;
        }

        // Binary and non-UTF-8 files fail here and are skipped.
        let content = match std::fs::read_to_string(entry.path()) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let relative = entry
            .path()
            .strip_prefix(project_path)
            .unwrap_or_else(|_| entry.path())
            .to_string_lossy()
            .replace('\\', "/");

        for (index, line) in content.lines().enumerate() {
            if !matches(line) {
                continue;
            }

            hits.push(SearchHit {
                path: relative.clone(),
                line: index as u32 + 1,
                text: line.trim().chars().take(MAX_TEXT_LENGTH).collect(),
            });

            if hits.len() >= limit {
                break;
            }
        }
    }

    hits
}

/// Case-insensitive substring search across the project.
#[tauri::command]
pub fn search_project(
    project_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit.unwrap_or(100).clamp(1, MAX_LIMIT);
    Ok(collect_hits(&project_path, limit, |line| {
        line.to_lowercase().contains(&query)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("crosscode-search-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Sources")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        dir
    }

    #[test]
    fn finds_matches_case_insensitively() {
        let dir = temp_project("basic");
        std::fs::write(
            dir.join("Sources").join("App.swift"),
            "struct App {}\nlet Title = \"Hello\"\n",
        )
        .unwrap();

        let hits = search_project(dir.to_string_lossy().to_string(), "hello".into(), None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "Sources/App.swift");
        assert_eq!(hits[0].line, 2);
        assert!(hits[0].text.contains("Hello"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_ignored_directories_and_empty_queries() {
        let dir = temp_project("ignored");
        std::fs::write(dir.join("node_modules").join("lib.js"), "hello\n").unwrap();
        std::fs::write(dir.join("Sources").join("App.swift"), "hello\n").unwrap();

        let root = dir.to_string_lossy().to_string();
        let hits = search_project(root.clone(), "hello".into(), None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "Sources/App.swift");

        assert!(search_project(root, "   ".into(), None).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_the_limit() {
        let dir = temp_project("limit");
        let lines = (0..50).map(|_| "needle").collect::<Vec<_>>().join("\n");
        std::fs::write(dir.join("Sources").join("App.swift"), lines).unwrap();

        let hits =
            search_project(dir.to_string_lossy().to_string(), "needle".into(), Some(5)).unwrap();
        assert_eq!(hits.len(), 5);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
