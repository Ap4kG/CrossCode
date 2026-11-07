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
pub struct GitBranch {
    /// Fully qualified name as git knows it (`feature/login`, `origin/main`).
    pub name: String,
    /// Branch name without the remote prefix, for display and for creating a
    /// local branch when a remote one is checked out.
    pub short_name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

/// Lists local branches plus the remote branches that have no local
/// counterpart, so the UI never offers to create a branch that already exists.
#[tauri::command]
pub fn git_branches(project_path: String) -> Result<Vec<GitBranch>, String> {
    let output = run_git(
        &project_path,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(symref)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;

    let mut local: Vec<GitBranch> = Vec::new();
    let mut remote: Vec<GitBranch> = Vec::new();

    for line in output.lines() {
        let mut fields = line.split('\t');
        let Some(reference) = fields.next() else {
            continue;
        };
        let short = fields.next().unwrap_or(reference);
        let head = fields.next().unwrap_or("");
        let symref = fields.next().unwrap_or("");

        // `origin/HEAD -> origin/main` is an alias, not something to check out.
        if !symref.is_empty() {
            continue;
        }

        let is_remote = reference.starts_with("refs/remotes/");
        let short_name = if is_remote {
            short.split_once('/').map(|(_, rest)| rest).unwrap_or(short)
        } else {
            short
        };

        let branch = GitBranch {
            name: short.to_string(),
            short_name: short_name.to_string(),
            is_current: head == "*",
            is_remote,
        };

        if is_remote {
            remote.push(branch);
        } else {
            local.push(branch);
        }
    }

    let known: Vec<String> = local.iter().map(|b| b.short_name.clone()).collect();
    remote.retain(|branch| !known.contains(&branch.short_name));

    local.sort_by(|a, b| a.name.cmp(&b.name));
    remote.sort_by(|a, b| a.name.cmp(&b.name));

    local.extend(remote);
    Ok(local)
}

fn validate_branch_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    // A leading dash would be parsed as a flag by git.
    if name.starts_with('-') {
        return Err("Branch name cannot start with '-'".to_string());
    }
    Ok(name)
}

/// Switches to an existing branch. Remote branches are checked out as a new
/// local branch that tracks them.
#[tauri::command]
pub fn git_checkout_branch(
    project_path: String,
    name: String,
    remote: Option<bool>,
) -> Result<(), String> {
    let name = validate_branch_name(&name)?;
    let mut args: Vec<&str> = vec!["switch"];

    if remote.unwrap_or(false) {
        let short_name = name.split_once('/').map(|(_, rest)| rest).unwrap_or(name);
        args.extend(["-c", short_name, "--track", name]);
    } else {
        args.push(name);
    }

    run_git(&project_path, &args).map(|_| ())
}

/// Creates a branch from the current HEAD and switches to it.
#[tauri::command]
pub fn git_create_branch(project_path: String, name: String) -> Result<(), String> {
    let name = validate_branch_name(&name)?;
    run_git(&project_path, &["switch", "-c", name]).map(|_| ())
}

/// Throws away uncommitted changes in the given files: tracked files are
/// restored from the index, untracked ones are deleted.
#[tauri::command]
pub fn git_discard(project_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    // `git restore` fails outright on a pathspec it does not know (untracked
    // files), and `git clean` would leave tracked files alone, so split the
    // list through the index first.
    let mut list: Vec<&str> = vec!["ls-files", "--"];
    list.extend(files.iter().map(String::as_str));
    let tracked_output = run_git(&project_path, &list)?;
    let tracked: Vec<String> = tracked_output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    let untracked: Vec<&String> = files
        .iter()
        .filter(|file| !tracked.contains(file))
        .collect();

    if !tracked.is_empty() {
        let mut restore: Vec<&str> = vec!["restore", "--worktree", "--"];
        restore.extend(tracked.iter().map(String::as_str));
        run_git(&project_path, &restore)?;
    }

    if !untracked.is_empty() {
        // `-d` so an untracked directory reported as `dir/` is removed whole.
        let mut clean: Vec<&str> = vec!["clean", "-fd", "--"];
        clean.extend(untracked.iter().map(|file| file.as_str()));
        run_git(&project_path, &clean)?;
    }

    Ok(())
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
        // Keep checkouts byte-for-byte identical to what the test wrote; Git for
        // Windows otherwise converts LF to CRLF and the assertions trip on it.
        run_git(&root, &["config", "core.autocrlf", "false"]).unwrap();

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
    fn creates_and_switches_branches() {
        let dir = temp_repo("branches");
        let root = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("hello.swift"), "let a = 1\n").unwrap();
        git_add(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        git_commit(root.clone(), "init".to_string(), None).unwrap();

        git_create_branch(root.clone(), "feature/login".to_string()).unwrap();
        let branches = git_branches(root.clone()).unwrap();
        assert_eq!(
            branches
                .iter()
                .find(|branch| branch.is_current)
                .map(|b| b.name.clone()),
            Some("feature/login".to_string())
        );

        let other = branches
            .iter()
            .find(|branch| !branch.is_current && !branch.is_remote)
            .map(|branch| branch.name.clone())
            .expect("the default branch should still be listed");
        git_checkout_branch(root.clone(), other.clone(), None).unwrap();

        let branches = git_branches(root.clone()).unwrap();
        assert_eq!(
            branches
                .iter()
                .find(|branch| branch.is_current)
                .map(|b| b.name.clone()),
            Some(other)
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_branch_names() {
        assert!(validate_branch_name("   ").is_err());
        assert!(validate_branch_name("--force").is_err());
        assert_eq!(
            validate_branch_name(" feature/login ").unwrap(),
            "feature/login"
        );
    }

    #[test]
    fn discards_tracked_and_untracked_changes() {
        let dir = temp_repo("discard");
        let root = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("hello.swift"), "let a = 1\n").unwrap();
        git_add(root.clone(), vec!["hello.swift".to_string()]).unwrap();
        git_commit(root.clone(), "init".to_string(), None).unwrap();

        std::fs::write(dir.join("hello.swift"), "let a = 2\n").unwrap();
        std::fs::write(dir.join("stray.swift"), "let b = 3\n").unwrap();

        git_discard(
            root.clone(),
            vec!["hello.swift".to_string(), "stray.swift".to_string()],
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join("hello.swift")).unwrap(),
            "let a = 1\n"
        );
        assert!(!dir.join("stray.swift").exists());
        assert!(git_status(root).unwrap().files.is_empty());

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
