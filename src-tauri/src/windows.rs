#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::sync::OnceLock;

// `wsl.exe` is a process spawn (hundreds of milliseconds). Every file read
// used to pay for it, so remember the answer for the lifetime of the process.
#[cfg(target_os = "windows")]
static HAS_WSL: OnceLock<bool> = OnceLock::new();

/// Fast path for `C:\Users\...` and `C:/Users/...` paths.
#[cfg(target_os = "windows")]
fn drive_path_to_wsl(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }

    let drive = (bytes[0] as char).to_ascii_lowercase();
    let rest = path[2..].replace('\\', "/");
    let rest = rest.trim_start_matches('/');

    Some(if rest.is_empty() {
        format!("/mnt/{}", drive)
    } else {
        format!("/mnt/{}/{}", drive, rest)
    })
}

/// Fast path for `/mnt/c/Users/...` paths.
#[cfg(target_os = "windows")]
fn wsl_drive_path_to_windows(path: &str) -> Option<String> {
    let rest = path.strip_prefix("/mnt/")?;
    let mut chars = rest.chars();
    let drive = chars.next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }

    let remainder = chars.as_str();
    if !(remainder.is_empty() || remainder.starts_with('/')) {
        return None;
    }

    let tail = remainder.trim_start_matches('/').replace('/', "\\");
    let drive = drive.to_ascii_uppercase();

    Some(if tail.is_empty() {
        format!("{}:\\", drive)
    } else {
        format!("{}:\\{}", drive, tail)
    })
}

#[cfg(target_os = "windows")]
pub fn windows_to_wsl_path(path: &str) -> Result<String, String> {
    if let Some(converted) = drive_path_to_wsl(path) {
        return Ok(converted);
    }

    let res = convert(path, Conversion::WindowsToWsl, false, true).map_err(|e| e.to_string());
    match res {
        Ok(path) => Ok(path),
        Err(err) => {
            let res2 = convert(path, Conversion::WindowsToWsl, false, false);
            match res2 {
                Ok(path) => Ok(path),
                Err(_) => Err(err),
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn wsl_to_windows_path(path: &str) -> Result<String, String> {
    // The mount root can be customized in wsl.conf, so only trust the fast
    // path when the translated path really exists.
    if let Some(converted) = wsl_drive_path_to_windows(path) {
        if std::path::Path::new(&converted).exists() {
            return Ok(converted);
        }
    }

    let res = convert(path, Conversion::WslToWindows, false, true).map_err(|e| e.to_string());
    match res {
        Ok(path) => Ok(path),
        Err(err) => {
            let res2 = convert(path, Conversion::WslToWindows, false, false);
            match res2 {
                Ok(path) => Ok(path),
                Err(_) => Err(err),
            }
        }
    }
}

#[tauri::command]
pub fn has_wsl() -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
    #[cfg(target_os = "windows")]
    {
        *HAS_WSL.get_or_init(detect_wsl)
    }
}

#[cfg(target_os = "windows")]
fn detect_wsl() -> bool {
    let output = Command::new("wsl")
        .arg("echo")
        .arg("1")
        .stdout(Stdio::piped())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    if let Err(err) = output {
        println!("Failed to execute WSL: {}", err);
        return false;
    }

    let output = output.unwrap();

    let output = String::from_utf8_lossy(&output.stdout);
    output.trim() == "1"
}

#[tauri::command]
pub fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

#[tauri::command]
pub fn install_wsl() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("powershell")
            .arg("-Command")
            .arg("Start-Process powershell -Verb runAs -ArgumentList '-NoExit','-Command','wsl --install Ubuntu-24.04; Write-Host \"`nIf this is your first time installing WSL, you must restart your PC to finish. It is safe to ignore the error about missing features. After restarting, open CrossCode and click Install WSL again to finish the installation.\"; Read-Host \"Press Enter to close\"'")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Taken from wslpath2 crate and modified
#[cfg(target_os = "windows")]
#[derive(Debug)]
pub enum Conversion {
    /// Convert Windows path to WSL path
    WindowsToWsl,
    /// Convert WSL path to Windows path
    WslToWindows,
}

#[cfg(target_os = "windows")]
pub fn convert(
    path: &str,
    options: Conversion,
    force_absolute_path: bool,
    replace_backslash: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut args = Vec::new();

    args.push("-e");
    args.push("wslpath");

    args.push(match options {
        Conversion::WindowsToWsl => "-u",
        Conversion::WslToWindows => "-w",
    });

    if force_absolute_path {
        args.push("-a");
    }

    let mut cmd = Command::new("wsl.exe");
    cmd.args(args);
    let real_path = if replace_backslash {
        path.replace('\\', "\\\\")
    } else {
        path.to_string()
    };
    cmd.arg(real_path);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd
        .output()
        .map_err(|e| format!("Error executing wsl.exe: {}", e))?;

    let code = output.status.code().unwrap_or(-1);
    if code != 0 {
        return Err(format!("Error getting wslpath: {}", code).into());
    }

    Ok(std::str::from_utf8(&output.stdout)
        .map_err(|e| format!("Error converting output to string: {}", e))?
        .trim()
        .to_string())
}
