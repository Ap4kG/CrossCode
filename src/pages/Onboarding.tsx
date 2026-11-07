import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import "./Onboarding.css";
import { Button, Box, Card, CardContent, Divider, IconButton, Link, Typography } from "@mui/joy";
import { useIDE } from "../utilities/IDEContext";
import logo from "../assets/logo.png";
import { useLocation, useNavigate } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import SwiftMenu from "../components/SwiftMenu";
import SDKMenu from "../components/SDKMenu";
import ErrorIcon from "@mui/icons-material/Error";
import WarningIcon from "@mui/icons-material/Warning";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "react-toast-plus";
import { relaunch } from "@tauri-apps/plugin-process";
import { platform } from "@tauri-apps/plugin-os";
import { SWIFT_VERSION_PREFIX } from "../utilities/constants";
import CloseIcon from "@mui/icons-material/Close";
import { useStore } from "../utilities/StoreContext";
import {
  RecentProject,
  formatRelativeTime,
  removeRecentProject,
} from "../utilities/recentProjects";

export default () => {
  const { ready, hasWSL, isWindows, openFolderDialog } = useIDE();
  const [version, setVersion] = useState<string>("");
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [recentProjects, setRecentProjects] = useStore<RecentProject[]>(
    "recent-projects",
    []
  );

  const isLinux = platform() === "linux";
  const [usbmuxd, setUsbmuxd] = useState<string | null>(null);
  const [usbmuxdBusy, setUsbmuxdBusy] = useState(false);

  const checkUsbmuxd = async () => {
    if (!isLinux) return;
    try {
      setUsbmuxd(await invoke<string>("usbmuxd_status"));
    } catch {
      setUsbmuxd("unknown");
    }
  };

  // Installs the package or starts the daemon through polkit, then re-checks.
  const fixUsbmuxd = async () => {
    setUsbmuxdBusy(true);
    try {
      await invoke(usbmuxd === "missing" ? "install_usbmuxd" : "start_usbmuxd");
      await checkUsbmuxd();
    } catch (error) {
      addToast.error(String(error));
    } finally {
      setUsbmuxdBusy(false);
    }
  };

  useEffect(() => {
    void checkUsbmuxd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLinux]);

  useEffect(() => {
    const fetchVersion = async () => {
      const version = await getVersion();
      setVersion(version);
    };
    fetchVersion();
  }, []);

  const location = useLocation();
  const darwinSdkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log(location.hash);
    if (location.hash === "#install-sdk" && darwinSdkRef.current) {
      darwinSdkRef.current.scrollIntoView({
        block: "start",
      });
    }
  }, [location.hash]);

  return (
    <div className="onboarding">
      <div className="onboarding-header">
        <img src={logo} alt="CrossCode Logo" className="onboarding-logo" />
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--padding-sm)",
            }}
          >
            <Typography level="h1">Welcome to CrossCode!</Typography>
            {version && <Typography level="body-sm">v{version}</Typography>}
          </div>
          <Typography level="body-sm">
            IDE for iOS Development on Windows and Linux
          </Typography>
        </div>
      </div>
      <div>
        <Typography
          level="h3"
          sx={{
            alignContent: "center",
            display: "flex",
            gap: "var(--padding-sm)",
          }}
          color="warning"
        >
          <WarningIcon sx={{ width: "1.5rem" }} /> Early Access Version{" "}
          <WarningIcon sx={{ width: "1.5rem" }} />
        </Typography>
        <Typography level="body-md">
          This is an early access version of CrossCode. Expect bugs. Please
          report any issues you find on{" "}
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault();
              open("https://github.com/nab138/CrossCode/issues");
            }}
          >
            github
          </Link>
          . Check the{" "}
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault();
              open("https://github.com/nab138/CrossCode/wiki/Troubleshooting");
            }}
          >
            troubleshooting guide
          </Link>{" "}
          for known issues and workarounds.
        </Typography>
      </div>
      <div className="onboarding-buttons">
        <Button
          size="lg"
          disabled={!ready}
          className={!ready ? "disabled-button" : ""}
          onClick={() => {
            if (ready) {
              navigate("/new");
            }
          }}
        >
          Create New
        </Button>
        <Button size="lg" disabled={!ready} onClick={openFolderDialog}>
          Open Project
        </Button>
      </div>

      {recentProjects.length > 0 && (
        <Card
          variant="soft"
          sx={{ width: "100%", maxWidth: "900px", marginTop: "var(--padding-sm)" }}
        >
          <Typography level="h3">Recent Projects</Typography>
          <Divider />
          <CardContent sx={{ gap: "var(--padding-xs)" }}>
            {recentProjects.slice(0, 5).map((project) => (
              <Box
                key={project.path}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--padding-xs)",
                }}
              >
                <Button
                  variant="plain"
                  disabled={!ready}
                  onClick={() =>
                    navigate("/ide/" + encodeURIComponent(project.path))
                  }
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    display: "block",
                    textAlign: "left",
                    justifyContent: "flex-start",
                  }}
                >
                  <Typography
                    level="body-sm"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {project.name}
                  </Typography>
                  <Typography
                    level="body-xs"
                    textColor="text.tertiary"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {project.path}
                  </Typography>
                  <Typography
                    level="body-xs"
                    textColor="text.tertiary"
                    sx={{ flexShrink: 0 }}
                  >
                    {formatRelativeTime(project.openedAt)}
                  </Typography>
                </Button>
                <IconButton
                  size="sm"
                  variant="plain"
                  title="Remove from recent projects"
                  onClick={() =>
                    setRecentProjects((previous) =>
                      removeRecentProject(previous, project.path)
                    )
                  }
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      <Typography
        level={ready ? "body-sm" : "body-md"}
        sx={{
          alignContent: "center",
          display: "flex",
          gap: "var(--padding-xs)",
        }}
        color={ready ? undefined : "danger"}
      >
        {ready ? (
          "Use the cards below to manage your CrossCode setup"
        ) : (
          <>
            <ErrorIcon />
            One or more issues need to be resolved before you can use CrossCode
          </>
        )}
      </Typography>
      <div className="onboarding-cards">
        {isWindows && (
          <Card variant="soft">
            <Typography level="h3">Windows Subsystem for Linux</Typography>
            <Typography level="body-sm">
              Windows Subsystem for Linux (WSL) is required to use CrossCode on
              Windows. Learn more about WSL on{" "}
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  open("https://learn.microsoft.com/en-us/windows/wsl/");
                }}
              >
                microsoft.com
              </Link>
              . We recommended WSL 2 and Ubuntu 24.04. Other distributions may
              work, but are not officially supported. CrossCode will use your
              default WSL distribution.
            </Typography>
            <Divider />
            <CardContent>
              <Typography
                level="body-md"
                sx={{
                  alignContent: "center",
                  display: "flex",
                  gap: "var(--padding-xs)",
                }}
                color={hasWSL === false ? "danger" : undefined}
              >
                {hasWSL === null ? (
                  "Checking for wsl..."
                ) : hasWSL ? (
                  "WSL is already installed on your system!"
                ) : (
                  <>
                    <ErrorIcon />{" "}
                    <div>
                      WSL is not installed on your system. CrossCode can attempt
                      to automatically install WSL. If it fails, follow the
                      guide on{" "}
                      <Link
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl(
                            "https://learn.microsoft.com/en-us/windows/wsl/install"
                          );
                        }}
                      >
                        microsoft.com
                      </Link>
                      .
                    </div>
                  </>
                )}
              </Typography>
              {!hasWSL && (
                <div
                  style={{
                    display: "flex",
                    gap: "var(--padding-md)",
                    marginTop: "var(--padding-xs)",
                  }}
                >
                  <Button
                    variant="soft"
                    onClick={async () => {
                      try {
                        await invoke("install_wsl");
                        addToast.success(
                          "Started WSL installation. It may take a while, and may ask you to restart your PC. If you are prompted to enter a username or password, choose whatever you like."
                        );
                      } catch (error) {
                        addToast.error(
                          "Failed to launch WSL installation. Please try installing it manually."
                        );
                      }
                    }}
                  >
                    Install WSL
                  </Button>
                  <Button
                    variant="soft"
                    onClick={async () => {
                      try {
                        await relaunch();
                      } catch (error) {
                        addToast.error(
                          "Failed to relaunch CrossCode. Please try manually."
                        );
                      }
                    }}
                  >
                    Relaunch CrossCode (post-installation)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {isLinux && (
          <Card variant="soft">
            <Typography level="h3">Device support (usbmuxd)</Typography>
            <Typography level="body-sm">
              CrossCode reaches your iPhone through the usbmuxd daemon. On Linux
              it is a separate package that has to be installed and running;
              Windows and macOS ship their own copy with the Apple tooling.
            </Typography>
            <Divider />
            <CardContent>
              <Typography
                level="body-md"
                sx={{
                  alignItems: "center",
                  display: "flex",
                  gap: "var(--padding-xs)",
                }}
                color={
                  usbmuxd === "running" || usbmuxd === null ? undefined : "danger"
                }
              >
                {usbmuxd === null ? (
                  "Checking for usbmuxd..."
                ) : usbmuxd === "running" ? (
                  "usbmuxd is running. Connect your iPhone over USB and trust this computer."
                ) : usbmuxd === "installed" ? (
                  <>
                    <WarningIcon />{" "}
                    <div>
                      usbmuxd is installed but not running. CrossCode can start
                      it for you, or run{" "}
                      <code>sudo systemctl enable --now usbmuxd</code>.
                    </div>
                  </>
                ) : (
                  <>
                    <ErrorIcon />{" "}
                    <div>
                      usbmuxd is not installed, so CrossCode cannot see a
                      connected iPhone. CrossCode can install it for you (you
                      will be asked for your password), or run{" "}
                      <code>sudo apt install usbmuxd</code> yourself.
                    </div>
                  </>
                )}
              </Typography>
              {usbmuxd !== "running" && (
                <div
                  style={{
                    display: "flex",
                    gap: "var(--padding-md)",
                    marginTop: "var(--padding-xs)",
                  }}
                >
                  {(usbmuxd === "missing" || usbmuxd === "installed") && (
                    <Button
                      variant="solid"
                      loading={usbmuxdBusy}
                      onClick={() => void fixUsbmuxd()}
                    >
                      {usbmuxd === "missing"
                        ? "Install usbmuxd"
                        : "Start usbmuxd"}
                    </Button>
                  )}
                  <Button
                    variant="soft"
                    disabled={usbmuxdBusy}
                    onClick={() => void checkUsbmuxd()}
                  >
                    Check again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Card variant="soft">
          <Typography level="h3">Swift</Typography>
          <Typography level="body-sm">
            You will need a Swift {SWIFT_VERSION_PREFIX} toolchain to use
            CrossCode. It is recommended to install it using swiftly, but you
            can also install it manually.
          </Typography>
          <Divider />
          <CardContent>
            <SwiftMenu />
          </CardContent>
        </Card>
        <Card variant="soft" id="install-sdk">
          <Typography level="h3">Darwin SDK</Typography>
          <Typography level="body-sm">
            CrossCode requires a special swift SDK to build apps for iOS. It can
            be generated from a copy of Xcode 26 or later. To install it,
            download Xcode.xip using the link below, click the "Install SDK"
            button, then select the downloaded file. Note that installing the
            SDK will temporarily require a lot of disk space (~11GB) and may
            take a while.
          </Typography>
          <Divider />
          <CardContent>
            <SDKMenu />
          </CardContent>
        </Card>
      </div>
      <div style={{ width: 0, height: 0 }} ref={darwinSdkRef}></div>
    </div>
  );
};
