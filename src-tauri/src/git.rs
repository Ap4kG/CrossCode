use serde::Serialize;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub code: String,
    pub staged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileStatus>,
}

fn run_git(project_path: &str, args: &[&str]) -> Result<String, String> {
    run_git_with_codes(project_path, args, &[0])
}

fn run_git_with_codes(
    project_path: &str,
    args: &[&str],
    allowed_codes: &[i32],
) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(project_path).args(args);

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("Failed to run git: {}", error))?;

    let code = output.status.code();
    let allowed = code
        .map(|code| allowed_codes.contains(&code))
        .unwrap_or(false);

    if !output.status.success() && !allowed {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git exited with code {:?}", code)
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn classify(code: &str) -> &'static str {
    if code == "??" {
        return "Untracked";
    }
    if code.contains('U') || code == "AA" || code == "DD" {
        return "Conflicted";
    }
    if code.contains('R') {
        return "Renamed";
    }
    if code.contains('A') {
        return "Added";
    }
    if code.contains('D') {
        return "Deleted";
    }
    if code.contains('M') {
        return "Modified";
    }
    if code.contains('C') {
        return "Copied";
    }
    "Changed"
}

fn parse_branch_line(rest: &str, status: &mut GitStatus) {
    let (branch_part, tracking) = match rest.split_once(" [") {
        Some((branch, tracking)) => (branch, Some(tracking)),
        None => (rest, None),
    };

    let branch = branch_part
        .split("...")
        .next()
        .unwrap_or(branch_part)
        .trim_start_matches("No commits yet on ");
    status.branch = Some(branch.to_string());

    if let Some(tracking) = tracking {
        for part in tracking.trim_end_matches(']').split(',') {
            let part = part.trim();
            if let Some(value) = part.strip_prefix("ahead ") {
                status.ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = part.strip_prefix("behind ") {
                status.behind = value.parse().unwrap_or(0);
            }
        }
    }
}

#[tauri::command]
pub fn git_status(project_path: String) -> Result<GitStatus, String> {
    let output = run_git(&project_path, &["status", "--porcelain=v1", "-b"])?;

    let mut status = GitStatus {
        is_repo: true,
        branch: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
    };

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            parse_branch_line(rest, &mut status);
            continue;
        }

        if line.len() < 4 {
            continue;
        }

        let code = &line[0..2];
        let raw_path = line[3..].trim();
        let path = raw_path
            .split(" -> ")
            .last()
            .unwrap_or(raw_path)
            .to_string();
        let staged = code
            .chars()
            .next()
            .map(|character| character != ' ' && character != '?')
            .unwrap_or(false);

        status.files.push(GitFileStatus {
            path,
            status: classify(code).to_string(),
            code: code.to_string(),
            staged,
        });
    }

    Ok(status)
}

#[tauri::command]
pub fn git_diff(
    project_path: String,
    file: String,
    staged: bool,
    untracked: bool,
) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["diff", "--no-color"];

    if untracked {
        // `git diff` ignores untracked files, so compare against /dev/null
        // instead. Git exits with 1 when the files differ, which is expected.
        args.push("--no-index");
        args.push("--");
        args.push("/dev/null");
        args.push(&file);
        return run_git_with_codes(&project_path, &args, &[0, 1]);
    }

    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&file);
    run_git(&project_path, &args)
}

/// Stages the given repository-relative paths.
#[tauri::command]
pub fn git_add(project_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(files.iter().map(String::as_str));
    run_git(&project_path, &args).map(|_| ())
}

/// Unstages the given repository-relative paths.
#[tauri::command]
pub fn git_reset(project_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let mut restore: Vec<&str> = vec!["restore", "--staged", "--"];
    restore.extend(files.iter().map(String::as_str));

    // `git restore --staged` needs a commit to compare against, which does not
    // exist in a freshly initialised repository.
    if run_git(&project_path, &restore).is_ok() {
        return Ok(());
    }

    let mut remove_cached: Vec<&str> = vec!["rm", "--cached", "-r", "--"];
    remove_cached.extend(files.iter().map(String::as_str));
    run_git(&project_path, &remove_cached).map(|_| ())
}

/// Commits the staged changes and returns git's stdout summary.
#[tauri::command]
pub fn git_commit(
    project_path: String,
    message: String,
    amend: Option<bool>,
) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    let mut args: Vec<&str> = vec!["commit"];
    if amend.unwrap_or(false) {
        args.push("--amend");
    }
    args.push("-m");
    args.push(message);

    run_git(&project_path, &args)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileVersions {
    /// `None` when the file does not exist in the compared revision.
    pub original: Option<String>,
    pub modified: Option<String>,
}

fn git_show(project_path: &str, spec: &str) -> Option<String> {
    run_git(project_path, &["show", spec]).ok()
}

fn read_worktree_file(project_path: &str, file: &str) -> Option<String> {
    std::fs::read_to_string(std::path::Path::new(project_path).join(file)).ok()
}

/// Returns the before/after contents of a file so the UI can render a real
/// side-by-side diff instead of parsing unified diff output.
#[tauri::command]
pub fn git_file_versions(
    project_path: String,
    file: String,
    staged: bool,
    untracked: bool,
) -> Result<GitFileVersions, String> {
    if untracked {
        return Ok(GitFileVersions {
            original: None,
            modified: read_worktree_file(&project_path, &file),
        });
    }

    let head = git_show(&project_path, &format!("HEAD:{}", file));
    let index = git_show(&project_path, &format!(":{}", file));

    if staged {
        return Ok(GitFileVersions {
            original: head,
            modified: index,
        });
    }

    Ok(GitFileVersions {
        original: index.or(head),
        modified: read_worktree_file(&project_path, &file),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_status() -> GitStatus {
        GitStatus {
            is_repo: true,
            branch: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
        }
    }

    #[test]
    fn classifies_porcelain_codes() {
        assert_eq!(classify("??"), "Untracked");
        assert_eq!(classify(" M"), "Modified");
        assert_eq!(classify("M "), "Modified");
        assert_eq!(classify("A "), "Added");
        assert_eq!(classify("D "), "Deleted");
        assert_eq!(classify("R "), "Renamed");
        assert_eq!(classify("UU"), "Conflicted");
    }

    #[test]
    fn parses_plain_branch() {
        let mut status = empty_status();
        parse_branch_line("main", &mut status);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn parses_tracking_information() {
        let mut status = empty_status();
        parse_branch_line(
            "feature/login...origin/feature/login [ahead 2, behind 1]",
            &mut status,
        );
        assert_eq!(status.branch.as_deref(), Some("feature/login"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
    }

    #[test]
    fn parses_repository_without_commits() {
        let mut status = empty_status();
        parse_branch_line("No commits yet on main", &mut status);
        assert_eq!(status.branch.as_deref(), Some("main"));
    }

    fn temp_repo(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("crosscode-git-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let root = dir.to_string_lossy().to_string();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.email", "tests@crosscode.invalid"]).unwrap();
        run_git(&root, &["config", "user.name", "CrossCode Tests"]).unwrap();

        dir
    }

    #[test]
    fn stages_unstages_and_commits() {
        let dir = temp_repo("stage");
        let root = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("hello.swift"), "print(1)\n").unwrap();

        let status = git_status(root.clone()).unwrap();
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "hello.swift" && file.status == "Untracked"));

        git_add(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        let status = git_status(root.clone()).unwrap();
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "hello.swift" && file.staged));

        // Unstaging has to work even though the repository has no commits yet.
        git_reset(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        let status = git_status(root.clone()).unwrap();
        assert!(!status
            .files
            .iter()
            .any(|file| file.path == "hello.swift" && file.staged));

        git_add(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        git_commit(root.clone(), "Add hello".to_string(), None).unwrap();
        let status = git_status(root.clone()).unwrap();
        assert!(status.files.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_empty_commit_message() {
        let dir = temp_repo("empty-message");
        let root = dir.to_string_lossy().to_string();
        assert!(git_commit(root, "   ".to_string(), None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_file_versions_for_diff() {
        let dir = temp_repo("versions");
        let root = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("hello.swift"), "let a = 1\n").unwrap();

        git_add(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        let versions =
            git_file_versions(root.clone(), "hello.swift".to_string(), true, false).unwrap();
        assert_eq!(versions.original, None);
        assert_eq!(versions.modified.as_deref(), Some("let a = 1\n"));

        git_commit(root.clone(), "init".to_string(), None).unwrap();
        std::fs::write(dir.join("hello.swift"), "let a = 2\n").unwrap();

        let versions =
            git_file_versions(root.clone(), "hello.swift".to_string(), false, false).unwrap();
        assert_eq!(versions.original.as_deref(), Some("let a = 1\n"));
        assert_eq!(versions.modified.as_deref(), Some("let a = 2\n"));

        let versions =
            git_file_versions(root.clone(), "hello.swift".to_string(), true, false).unwrap();
        assert_eq!(versions.original.as_deref(), Some("let a = 1\n"));
        assert_eq!(versions.modified.as_deref(), Some("let a = 1\n"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
