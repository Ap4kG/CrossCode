use std::path::PathBuf;

use idevice::{
    lockdown::LockdownClient,
    mobile_image_mounter::ImageMounter,
    provider::UsbmuxdProvider,
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection},
    IdeviceService,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Window};

const BUILD_MANIFEST_URL: &str =
    "https://github.com/doronz88/DeveloperDiskImage/raw/refs/heads/main/PersonalizedImages/Xcode_iOS_DDI_Personalized/BuildManifest.plist";
const PERSONALIZED_IMAGE_URL: &str =
    "https://github.com/doronz88/DeveloperDiskImage/raw/refs/heads/main/PersonalizedImages/Xcode_iOS_DDI_Personalized/Image.dmg";
const TRUST_CACHE_URL: &str = "https://github.com/doronz88/DeveloperDiskImage/raw/refs/heads/main/PersonalizedImages/Xcode_iOS_DDI_Personalized/Image.dmg.trustcache";

#[derive(Deserialize, Serialize, Clone)]
pub struct DeviceInfo {
    pub name: String,
    pub id: u32,
    pub uuid: String,
}

pub async fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    let usbmuxd = UsbmuxdConnection::default().await;
    if usbmuxd.is_err() {
        eprintln!("Failed to connect to usbmuxd: {:?}", usbmuxd.err());
        return Err("Failed to connect to usbmuxd".to_string());
    }
    let mut usbmuxd = usbmuxd.unwrap();

    let devs = usbmuxd.get_devices().await.unwrap();
    if devs.is_empty() {
        return Ok(vec![]);
    }

    let device_info_futures: Vec<_> = devs
        .iter()
        .map(|d| async move {
            let provider = d.to_provider(UsbmuxdAddr::from_env_var().unwrap(), "crosscode");
            let device_uid = d.device_id;

            let mut lockdown_client = match LockdownClient::connect(&provider).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Unable to connect to lockdown: {e:?}");
                    return DeviceInfo {
                        name: String::from("Unknown Device"),
                        id: device_uid,
                        uuid: d.udid.clone(),
                    };
                }
            };

            let device_name = lockdown_client
                .get_value(Some("DeviceName"), None)
                .await
                .expect("Failed to get device name")
                .as_string()
                .expect("Failed to convert device name to string")
                .to_string();

            DeviceInfo {
                name: device_name,
                id: device_uid,
                uuid: d.udid.clone(),
            }
        })
        .collect();

    Ok(futures::future::join_all(device_info_futures).await)
}

pub async fn get_provider(device: &DeviceInfo) -> Result<UsbmuxdProvider, String> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(|e| format!("Failed to connect to usbmuxd: {}", e))?;
    let device_info = usbmuxd
        .get_device(&device.uuid)
        .await
        .map_err(|e| format!("Failed to get device: {}", e))?;

    let provider = device_info.to_provider(UsbmuxdAddr::from_env_var().unwrap(), "crosscode");
    Ok(provider)
}

#[tauri::command]
pub async fn is_ddi_mounted(device: DeviceInfo) -> Result<bool, String> {
    let provider = get_provider(&device).await?;

    let mut mounter_client = ImageMounter::connect(&provider).await.map_err(|e| {
        format!(
            "Failed to connect to mobile image mounter on device {}: {}",
            device.name, e
        )
    })?;

    let devices = mounter_client.copy_devices().await.map_err(|e| {
        format!(
            "Failed to get mounted images on device {}: {}",
            device.name, e
        )
    })?;

    Ok(!devices.is_empty())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub device_name: String,
    pub product_version: Option<String>,
    pub build_version: Option<String>,
    pub developer_mode_enabled: Option<bool>,
    pub ddi_mounted: bool,
}

#[tauri::command]
pub async fn device_status(device: DeviceInfo) -> Result<DeviceStatus, String> {
    let provider = get_provider(&device).await?;

    let mut lockdown_client = LockdownClient::connect(&provider)
        .await
        .map_err(|e| format!("Failed to connect to lockdown: {}", e))?;

    let product_version = lockdown_client
        .get_value(Some("ProductVersion"), None)
        .await
        .ok()
        .and_then(|value| value.as_string().map(|value| value.to_string()));

    let build_version = lockdown_client
        .get_value(Some("BuildVersion"), None)
        .await
        .ok()
        .and_then(|value| value.as_string().map(|value| value.to_string()));

    let developer_mode_enabled = lockdown_client
        .get_value(Some("DeveloperModeStatus"), None)
        .await
        .ok()
        .and_then(|value| value.as_boolean());

    let ddi_mounted = is_ddi_mounted(device.clone()).await.unwrap_or(false);

    Ok(DeviceStatus {
        device_name: device.name,
        product_version,
        build_version,
        developer_mode_enabled,
        ddi_mounted,
    })
}

// https://github.com/jkcoxson/idevice/blob/master/tools/src/mounter.rs
#[tauri::command]
pub async fn mount_ddi(app: AppHandle, window: Window, device: DeviceInfo) -> Result<(), String> {
    let provider = get_provider(&device).await?;

    let mut mounter_client = ImageMounter::connect(&provider).await.map_err(|e| {
        format!(
            "Failed to connect to mobile image mounter on device {}: {}",
            device.name, e
        )
    })?;

    let mut lockdown_client = LockdownClient::connect(&provider)
        .await
        .map_err(|e| format!("Failed to connect to lockdown: {}", e))?;

    let product_version = lockdown_client
        .get_value(Some("ProductVersion"), None)
        .await
        .map_err(|e| format!("Failed to get product version: {}", e))?;

    let product_version = product_version
        .as_string()
        .ok_or("Unexpected value for ProductVersion")?;

    let product_version_num = product_version.split('.').collect::<Vec<&str>>()[0]
        .parse::<u8>()
        .map_err(|e| format!("Failed to parse product version: {}", e))?;

    if product_version_num < 17 {
        // make sure product version is x.x, trimming the final .x if it exists
        let product_version = if product_version.matches('.').count() > 1 {
            let mut parts = product_version.split('.').collect::<Vec<&str>>();
            parts.pop();
            parts.join(".")
        } else {
            product_version.to_string()
        };

        let (image, signature) = download_ddi(&app, &product_version).await?;

        let image = tokio::fs::read(image)
            .await
            .map_err(|e| format!("Unable to read image: {}", e))?;
        let signature = tokio::fs::read(signature)
            .await
            .map_err(|e| format!("Unable to read signature: {}", e))?;

        mounter_client
            .mount_developer(&image, signature)
            .await
            .map_err(|e| format!("Unable to mount: {}", e))?;
    } else {
        let (manifest, trust_cache, image) = download_personalized_image(&app).await?;

        let image = tokio::fs::read(image)
            .await
            .map_err(|e| format!("Unable to read image: {}", e))?;

        let build_manifest = &tokio::fs::read(manifest)
            .await
            .map_err(|e| format!("Unable to read build manifest: {}", e))?;

        let trust_cache = tokio::fs::read(trust_cache)
            .await
            .map_err(|e| format!("Unable to read trust cache: {}", e))?;

        let unique_chip_id = lockdown_client
            .get_value(Some("UniqueChipID"), None)
            .await
            .map_err(|e| format!("Failed to get UniqueChipID: {}", e))?
            .as_unsigned_integer()
            .ok_or("Unexpected value for UniqueChipID")?;

        mounter_client
            .mount_personalized_with_callback(
                &provider,
                image,
                trust_cache,
                build_manifest,
                None,
                unique_chip_id,
                async |((n, d), _)| {
                    let percent = (n as f64 / d as f64) * 100.0;
                    window
                        .emit("ddi-mount-progress", percent)
                        .unwrap_or_else(|e| {
                            eprintln!("Failed to emit ddi-mount-progress: {}", e);
                        });
                },
                (),
            )
            .await
            .map_err(|e| format!("Unable to mount image: {}", e))?;
    }

    Ok(())
}

pub async fn download_ddi(
    app: &AppHandle,
    product_version: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let ddi_path = config_dir.join("DDI");

    let image_path = ddi_path.join("DeveloperDiskImage.dmg");
    let sig_path = ddi_path.join("DeveloperDiskImage.dmg.signature");

    if !ddi_path.exists() {
        tokio::fs::create_dir_all(&ddi_path)
            .await
            .map_err(|e| format!("Failed to create DDI directory: {}", e))?;
    }

    let mut download_futures = vec![];
    if !image_path.exists() {
        let url = format!(
        "https://github.com/doronz88/DeveloperDiskImage/raw/refs/heads/main/DeveloperDiskImages/{}/DeveloperDiskImage.dmg",
        product_version
    );
        download_futures.push(download(url, &image_path));
    }
    if !sig_path.exists() {
        let url = format!(
        "https://github.com/doronz88/DeveloperDiskImage/raw/refs/heads/main/DeveloperDiskImages/{}/DeveloperDiskImage.dmg.signature",
        product_version
    );
        download_futures.push(download(url, &sig_path));
    }

    futures::future::join_all(download_futures).await;

    Ok((image_path, sig_path))
}

pub async fn download_personalized_image(
    app: &AppHandle,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let ddi_path = config_dir.join("DDI");

    let build_manifest_path = ddi_path.join("BuildManifest.plist");
    let trust_cache_path = ddi_path.join("Image.dmg.trustcache");
    let image_path = ddi_path.join("Image.dmg");

    if !ddi_path.exists() {
        tokio::fs::create_dir_all(&ddi_path)
            .await
            .map_err(|e| format!("Failed to create DDI directory: {}", e))?;
    }

    let mut download_futures = vec![];
    if !build_manifest_path.exists() {
        download_futures.push(download(BUILD_MANIFEST_URL, &build_manifest_path));
    }
    if !trust_cache_path.exists() {
        download_futures.push(download(TRUST_CACHE_URL, &trust_cache_path));
    }
    if !image_path.exists() {
        download_futures.push(download(PERSONALIZED_IMAGE_URL, &image_path));
    }
    futures::future::join_all(download_futures).await;

    Ok((build_manifest_path, trust_cache_path, image_path))
}

pub async fn download(url: impl AsRef<str>, dest: &PathBuf) -> Result<(), String> {
    let response = reqwest::get(url.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download file: HTTP {}",
            response.status()
        ));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(dest, &bytes)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Where usbmuxd listens for device connections on Linux.
#[cfg(target_os = "linux")]
const USB_MUXD_SOCKETS: [&str; 2] = ["/var/run/usbmuxd", "/run/usbmuxd"];

/// Looks a program up in `PATH`. Returns the absolute path so the same lookup
/// can be reused for `pkexec`, which wants a real executable path.
#[cfg(target_os = "linux")]
fn resolve_command(name: &str) -> Option<std::path::PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.is_file())
    })
}

/// Reports on the usbmuxd daemon, which is what `idevice` talks to.
///
/// Windows and macOS ship their own copy as part of the Apple tooling, so the
/// answer there is always `not-applicable`. On Linux the daemon is a separate
/// package and has to be running before a device can be enumerated.
#[cfg(target_os = "linux")]
fn detect_usbmuxd() -> String {
    if USB_MUXD_SOCKETS
        .iter()
        .any(|socket| std::path::Path::new(socket).exists())
    {
        return String::from("running");
    }

    if resolve_command("usbmuxd").is_some() {
        String::from("installed")
    } else {
        String::from("missing")
    }
}

#[tauri::command]
pub fn usbmuxd_status() -> String {
    #[cfg(target_os = "linux")]
    {
        detect_usbmuxd()
    }
    #[cfg(not(target_os = "linux"))]
    {
        String::from("not-applicable")
    }
}

/// The install command for the detected distribution.
#[cfg(target_os = "linux")]
fn usbmuxd_install_command() -> Result<&'static str, String> {
    if resolve_command("apt-get").is_some() {
        Ok("DEBIAN_FRONTEND=noninteractive apt-get install -y usbmuxd")
    } else if resolve_command("dnf").is_some() {
        Ok("dnf install -y usbmuxd")
    } else if resolve_command("pacman").is_some() {
        Ok("pacman -Sy --noconfirm --needed usbmuxd")
    } else if resolve_command("zypper").is_some() {
        Ok("zypper --non-interactive install usbmuxd")
    } else {
        Err("Unsupported distribution: install the 'usbmuxd' package manually.".to_string())
    }
}

/// Runs a shell snippet as root through polkit, which shows the desktop's own
/// password prompt instead of requiring a terminal.
#[cfg(target_os = "linux")]
async fn run_privileged(script: &str) -> Result<String, String> {
    let pkexec = resolve_command("pkexec").ok_or_else(|| {
        "polkit (pkexec) is not installed, so CrossCode cannot ask for a password. Run the command in a terminal instead.".to_string()
    })?;
    let sh = resolve_command("sh").ok_or_else(|| "sh was not found in PATH".to_string())?;

    let output = tokio::process::Command::new(pkexec)
        .arg(sh)
        .arg("-c")
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("Failed to run pkexec: {}", e))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        "The package manager exited with an error.".to_string()
    } else {
        stderr
    })
}

/// Installs usbmuxd with the distribution's package manager and enables the
/// service, so the device shows up without a reboot.
#[tauri::command]
pub async fn install_usbmuxd() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let install = usbmuxd_install_command()?;
        let script = format!("{} && systemctl enable --now usbmuxd", install);
        run_privileged(&script).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("usbmuxd is only a separate package on Linux.".to_string())
    }
}

/// Enables and starts the service when the package is already installed but
/// the daemon is not running.
#[tauri::command]
pub async fn start_usbmuxd() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        run_privileged("systemctl enable --now usbmuxd").await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("usbmuxd is only a separate package on Linux.".to_string())
    }
}
