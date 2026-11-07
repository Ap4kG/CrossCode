import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import * as dialog from "@tauri-apps/plugin-dialog";
import { useToast } from "react-toast-plus";

type AvailableUpdate = Awaited<ReturnType<typeof check>>;

export interface UpdateContextType {
  checkForUpdates: () => Promise<void>;
  /** Version of the update found in the background, if any. */
  availableVersion: string | null;
  /** Checks without prompting. Returns the new version or null. */
  checkSilently: () => Promise<string | null>;
  /** Downloads and installs the update found by `checkSilently`. */
  installAvailable: () => Promise<void>;
  /** Hides the banner until the next launch. */
  dismissUpdate: () => void;
}

export const UpdateContext = createContext<UpdateContextType>({
  checkForUpdates: async () => {},
  availableVersion: null,
  checkSilently: async () => null,
  installAvailable: async () => {},
  dismissUpdate: () => {},
});

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { addToast } = useToast();
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const pendingUpdate = useRef<AvailableUpdate>(null);

  const downloadAndInstall = useCallback(
    async (update: NonNullable<AvailableUpdate>) => {
      const downloadPromise = update.download();
      addToast.promise(downloadPromise, {
        pending: "Downloading update...",
        success: "Update downloaded",
        error: "Failed to download update",
      });
      await downloadPromise;

      const installPromise = update.install();
      addToast.promise(installPromise, {
        pending: "Installing update...",
        success: "Update installed",
        error: "Failed to install update",
      });
      await installPromise;

      const shouldRelaunch = await dialog.ask(
        "The update has been installed. Would you like to relaunch the application?",
        { title: "Relaunch Required" }
      );
      if (shouldRelaunch) {
        await relaunch();
      } else {
        setAvailableVersion(null);
        pendingUpdate.current = null;
      }
    },
    [addToast]
  );

  const installAvailable = useCallback(async () => {
    if (!pendingUpdate.current) {
      const version = await check();
      if (!version) {
        addToast.error("No update available.");
        return;
      }
      pendingUpdate.current = version;
    }
    await downloadAndInstall(pendingUpdate.current);
  }, [addToast, downloadAndInstall]);

  const checkSilently = useCallback(async () => {
    try {
      const update = await check();
      if (!update) {
        pendingUpdate.current = null;
        setAvailableVersion(null);
        return null;
      }
      pendingUpdate.current = update;
      setAvailableVersion(update.version);
      return update.version;
    } catch (error) {
      console.error("Update check failed:", error);
      return null;
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    const update = await check();
    if (!update) return;

    let shouldUpdate = await dialog.ask(
      "A new update (" +
        (await getVersion()) +
        " -> " +
        update.version +
        ") is available. Would you like to install it?",
      { title: "Update Available" }
    );

    if (!shouldUpdate) return;
    await downloadAndInstall(update);
  }, [downloadAndInstall]);

  // Look for updates once per launch, but stay quiet when offline: this only
  // drives the banner, the explicit menu command still prompts.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkSilently();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [checkSilently]);

  const dismissUpdate = useCallback(() => {
    setAvailableVersion(null);
  }, []);

  return (
    <UpdateContext.Provider
      value={{
        checkForUpdates,
        availableVersion,
        checkSilently,
        installAvailable,
        dismissUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};
