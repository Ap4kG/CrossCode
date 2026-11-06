import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Modal,
  ModalClose,
  ModalDialog,
  Typography,
} from "@mui/joy";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { invoke } from "@tauri-apps/api/core";
import { useIDE } from "../utilities/IDEContext";

export interface DeviceWizardProps {
  open: boolean;
  onClose: () => void;
}

type DeviceStatus = {
  deviceName: string;
  productVersion: string | null;
  buildVersion: string | null;
  developerModeEnabled: boolean | null;
  ddiMounted: boolean;
};

type ChecklistState = "ok" | "missing" | "unknown";

function ChecklistRow({
  state,
  title,
  detail,
}: {
  state: ChecklistState;
  title: string;
  detail: string;
}) {
  const Icon =
    state === "ok"
      ? CheckCircleIcon
      : state === "missing"
        ? ErrorOutlineIcon
        : HelpOutlineIcon;

  const color =
    state === "ok" ? "success.500" : state === "missing" ? "danger.500" : "warning.500";

  return (
    <Box sx={{ display: "flex", gap: "var(--padding-sm)" }}>
      <Icon sx={{ color, fontSize: 20, flexShrink: 0, marginTop: "2px" }} />
      <Box>
        <Typography level="body-sm" sx={{ fontWeight: "lg" }}>
          {title}
        </Typography>
        <Typography level="body-xs" textColor="text.tertiary">
          {detail}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Guided check for the things iOS requires before an app can be installed:
 * a connected device, a mounted developer disk image and iOS 16+ Developer
 * Mode switched on in Settings.
 */
export default ({ open, onClose }: DeviceWizardProps) => {
  const { devices, selectedDevice, mountDdi } = useIDE();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounting, setMounting] = useState(false);

  const check = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DeviceStatus>("device_status", {
        device: selectedDevice,
      });
      setStatus(result);
    } catch (statusError) {
      setStatus(null);
      setError(String(statusError));
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    check();
  }, [open, check]);

  const handleMount = useCallback(async () => {
    setMounting(true);
    try {
      await mountDdi(true);
      await check();
    } catch (mountError) {
      setError(String(mountError));
    } finally {
      setMounting(false);
    }
  }, [mountDdi, check]);

  const developerModeState: ChecklistState = !status
    ? "unknown"
    : status.developerModeEnabled === true
      ? "ok"
      : status.developerModeEnabled === false
        ? "missing"
        : "unknown";

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: "min(640px, 92vw)", maxHeight: "85vh", overflowY: "auto" }}>
        <ModalClose />
        <Typography level="h4">Device setup</Typography>
        <Typography level="body-sm" textColor="text.tertiary">
          CrossCode can only build and install apps when the device is prepared
          for development. This check runs the same steps Xcode expects.
        </Typography>
        <Divider />

        {!selectedDevice && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <ChecklistRow
              state="missing"
              title="No device selected"
              detail="Connect an iPhone or iPad with a USB cable and pick it in the device selector."
            />
            {devices.length > 0 && (
              <Typography level="body-xs" textColor="text.tertiary">
                Detected devices: {devices.map((device) => device.name).join(", ")}
              </Typography>
            )}
          </Box>
        )}

        {selectedDevice && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--padding-sm)" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography level="body-md" sx={{ fontWeight: "lg" }}>
                {status?.deviceName ?? selectedDevice.name}
              </Typography>
              {status?.productVersion && (
                <Chip size="sm" variant="soft">
                  iOS {status.productVersion}
                  {status.buildVersion ? ` (${status.buildVersion})` : ""}
                </Chip>
              )}
            </Box>

            {loading && <CircularProgress size="sm" />}

            {!loading && error && (
              <Typography level="body-sm" color="danger">
                {error}
              </Typography>
            )}

            {!loading && !error && status && (
              <>
                <ChecklistRow
                  state="ok"
                  title="Device connected"
                  detail="USB connection and pairing are working."
                />
                <ChecklistRow
                  state={status.ddiMounted ? "ok" : "missing"}
                  title="Developer disk image (DDI)"
                  detail={
                    status.ddiMounted
                      ? "Mounted. This is what allows debugging and installing builds."
                      : "Not mounted yet. Mount it below; the download happens once per iOS version."
                  }
                />
                <ChecklistRow
                  state={developerModeState}
                  title="Developer Mode"
                  detail={
                    developerModeState === "ok"
                      ? "Enabled."
                      : developerModeState === "missing"
                        ? "Disabled. On the device open Settings → Privacy & Security → Developer Mode, turn it on, then restart the iPhone and confirm."
                        : "Could not read the state from the device. If the toggle is missing in Settings, mount the DDI first, then reboot the device."
                  }
                />
                <Typography level="body-xs" textColor="text.tertiary">
                  After enabling Developer Mode the device reboots and asks for the
                  passcode. Come back to this window and re-run the check.
                </Typography>
              </>
            )}

            <Box sx={{ display: "flex", gap: "var(--padding-sm)", marginTop: "var(--padding-xs)" }}>
              <Button size="sm" variant="outlined" loading={loading} onClick={check}>
                Re-check
              </Button>
              {status && !status.ddiMounted && (
                <Button
                  size="sm"
                  variant="solid"
                  loading={mounting}
                  onClick={handleMount}
                >
                  Mount developer image
                </Button>
              )}
            </Box>
          </Box>
        )}
      </ModalDialog>
    </Modal>
  );
};
