import Splitter, { GutterTheme, SplitDirection } from "@devbookhq/splitter";
import Tile from "../components/Tiles/Tile";
import FileExplorer from "../components/Tiles/FileExplorer";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor from "../components/Tiles/Editor";
import MenuBar from "../components/Menu/MenuBar";
import "./IDE.css";
import { StoreContext, useStore } from "../utilities/StoreContext";
import { useNavigate, useParams } from "react-router";
import { useIDE } from "../utilities/IDEContext";
import { registerFileSystemOverlay } from "@codingame/monaco-vscode-files-service-override";
import TauriFileSystemProvider from "../utilities/TauriFileSystemProvider";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Divider,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Typography,
} from "@mui/joy";
import { ErrorIcon, useToast, WarningIcon } from "react-toast-plus";
import SwiftMenu from "../components/SwiftMenu";
import { restartServer } from "../utilities/lsp-client";
import BottomBar from "../components/Tiles/BottomBar";
import { open as openFileDialog, save } from "@tauri-apps/plugin-dialog";
import { IStandaloneCodeEditor } from "@codingame/monaco-vscode-api/vscode/vs/editor/standalone/browser/standaloneCodeEditor";
import { DARWIN_SDK_VERSION } from "../utilities/constants";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import QuickOpen from "../components/QuickOpen";
import DeviceWizard from "../components/DeviceWizard";
import { path as pathApi } from "@tauri-apps/api";
import {
  addRecentProject,
  RecentProject,
} from "../utilities/recentProjects";
import { addRecentFile } from "../utilities/recentFiles";
import QuickPick, { QuickPickItem } from "../components/QuickPick";
import ProjectSearch from "../components/ProjectSearch";
import UpdateBanner from "../components/UpdateBanner";
import { extractSymbols, symbolGlyph } from "../utilities/symbols";
import { basename as pathBasename, joinPath } from "../utilities/paths";
import { nativePath, nativePathSync } from "../utilities/nativePath";

type ProjectValidation =
  | "Valid"
  | "Invalid"
  | "UnsupportedFormatVersion"
  | "InvalidPackage"
  | "InvalidToolchain";

let autoStartedLsp = "";

/** Path identity across Windows (`C:\x`) and WSL (`/mnt/c/x`) forms. */
function comparableFilePath(file: string): string {
  return nativePathSync(file).replace(/\\/g, "/").toLowerCase();
}

export default () => {
  const { storeInitialized, store } = useContext(StoreContext);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const [quickOpen, setQuickOpen] = useState(false);
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
  const [reveal, setReveal] = useState<{ file: string; line: number } | null>(
    null
  );
  const [saveFile, setSaveFile] = useState<(() => Promise<void>) | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [redo, setRedo] = useState<(() => void) | null>(null);
  const [theme] = useStore<"light" | "dark">("appearance/theme", "dark");
  const [mainSizes, setMainSizes] = useStore<number[]>("layout/main-sizes", []);
  const [verticalSizes, setVerticalSizes] = useStore<number[]>(
    "layout/vertical-sizes",
    []
  );
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [symbolsPickerOpen, setSymbolsPickerOpen] = useState(false);
  const [recentPickerOpen, setRecentPickerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { path } = useParams<"path">();
  const {
    openFolderDialog,
    selectedToolchain,
    hasLimitedRam,
    initialized,
    ready,
    darwinSDKVersion,
    screenshot,
    setScreenshot,
  } = useIDE();
  const [sourcekitStartup, setSourcekitStartup] = useStore<boolean | null>(
    "sourcekit/startup",
    null
  );
  const [hasIgnoredRam, setHasIgnoredRam] = useStore<boolean>(
    "has-ignored-ram",
    false
  );

  const [hasIgnoredDarwinSDK, setHasIgnoredDarwinSDK] = useStore<boolean>(
    "has-ignored-darwin-sdk",
    false
  );

  const [, setRecentProjects] = useStore<RecentProject[]>(
    "recent-projects",
    []
  );

  const [recentFiles, setRecentFiles] = useStore<string[]>(
    "recent-files",
    []
  );
  // `useStore` setters change identity whenever the stored value changes, so
  // keep them in refs to leave `openNewFile` (passed to several children)
  // referentially stable.
  const recentFilesRef = useRef(recentFiles);
  const setRecentFilesRef = useRef(setRecentFiles);
  recentFilesRef.current = recentFiles;
  setRecentFilesRef.current = setRecentFiles;

  if (!path) {
    throw new Error("Path parameter is required in IDE component");
  }

  const [callbacks, setCallbacks] = useState<
    Record<string, (() => void) | (() => Promise<void>)>
  >({});
  const navigate = useNavigate();
  const [projectValidation, setProjectValidation] =
    useState<ProjectValidation | null>(null);
  const [editor, setEditor] = useState<IStandaloneCodeEditor | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (ready === false && initialized) {
      console.log(
        "IDE not ready, returning to welcome page",
        ready,
        initialized
      );
      navigate("/");
    }
  }, [ready, initialized, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!store || !storeInitialized || !path) return;
      await store.set("last-opened-project", encodeURIComponent(path!));
      try {
        const name = await pathApi.basename(path);
        if (cancelled) return;
        // The setter is intentionally not in the dependency list: it changes
        // identity whenever the stored list changes, which would re-add the
        // project forever.
        setRecentProjects((previous) =>
          addRecentProject(previous, {
            path,
            name,
            openedAt: Date.now(),
          })
        );
      } catch (error) {
        console.error("Failed to update recent projects:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, store, storeInitialized]);

  useEffect(() => {
    if (
      path === undefined ||
      path === null ||
      selectedToolchain === null ||
      !initialized
    )
      return;
    setProjectValidation(null);
    (async () => {
      if (path) {
        const toolchainPath = selectedToolchain?.path ?? "";
        const validation = await invoke<ProjectValidation>("validate_project", {
          projectPath: path,
          toolchainPath: toolchainPath,
        });
        if (validation) {
          setProjectValidation(validation);
        }
      }
    })();
  }, [path, selectedToolchain, initialized]);

  useEffect(() => {
    if (openFiles.length === 0) {
      setOpenFile(null);
    }
    if (!openFiles.includes(openFile!)) {
      setOpenFile(openFiles[0]);
    }
  }, [openFiles]);

  useEffect(() => {
    let dispose = () => {};

    if (path) {
      const provider = new TauriFileSystemProvider(false);
      const overlayDisposable = registerFileSystemOverlay(1, provider);
      dispose = () => {
        overlayDisposable.dispose();
        provider.dispose();
      };
    }
    return () => {
      dispose();
    };
  }, [path]);

  useEffect(() => {
    let autoEnable = async () => {
      if (initialized && sourcekitStartup === null && hasLimitedRam === false) {
        setSourcekitStartup(true);
      }
    };
    autoEnable();
  }, [hasLimitedRam, initialized, sourcekitStartup]);

  useEffect(() => {
    if (!sourcekitStartup || selectedToolchain == null) return;
    requestAnimationFrame(async () => {
      try {
        if (autoStartedLsp === path) return;
        autoStartedLsp = path;
        await restartServer(path, selectedToolchain);
      } catch (e) {
        console.error("Failed to start SourceKit-LSP:", e);
        addToast.error(
          "Failed to start SourceKit-LSP (see devtools for details). Some language features may not be available."
        );
      }
    });
  }, [sourcekitStartup, path, selectedToolchain]);

  const openNewFile = useCallback((file: string) => {
    setOpenFile(file);
    setOpenFiles((oF) => {
      if (!oF.includes(file)) return [file, ...oF];
      return oF;
    });
    setRecentFilesRef.current(addRecentFile(recentFilesRef.current, file));
  }, []);

  // Quick Open can ask for a specific line (`file:42`, content search hits).
  // Tools report paths in different shapes (`C:\...` vs `/mnt/c/...`), so reuse
  // an already-open tab when it points at the same file.
  const openNewFileAt = useCallback(
    (file: string, line?: number) => {
      const wanted = comparableFilePath(file);
      const existing = openFilesRef.current.find(
        (open) => comparableFilePath(open) === wanted
      );
      const target = existing ?? file;
      openNewFile(target);
      setReveal(line && line > 0 ? { file: target, line } : null);
    },
    [openNewFile]
  );

  // Stable so the editor effect does not re-run on every render.
  const clearReveal = useCallback(() => setReveal(null), []);

  const selectFile = useCallback(async () => {
    const file = await openFileDialog({ multiple: false, directory: false });
    if (file) {
      openNewFile(file);
    }
  }, [openNewFile]);

  const triggerFind = useCallback(
    (action: string) => {
      if (!editor) return;
      editor.trigger("menu", action, null);
      editor.focus();
    },
    [editor]
  );

  // Reads crosscode.toml, increments version_num and writes it back. The editor
  // reloads the file through the same event "Replace in Project" uses.
  const bumpBuild = useCallback(async () => {
    if (!path) return;
    try {
      const file = joinPath(path, "crosscode.toml");
      const native = await nativePath(file);
      const text = await readTextFile(native);
      const pattern = /(^[ \t]*version_num[ \t]*=[ \t]*")(\d+)(")/m;
      const match = pattern.exec(text);
      if (!match) {
        addToast.error("crosscode.toml has no numeric version_num to bump.");
        return;
      }

      const next = String(Number(match[2]) + 1);
      await writeTextFile(native, text.replace(pattern, `$1${next}$3`));
      addToast.success(`Build number bumped to ${next}`);
      window.dispatchEvent(
        new CustomEvent("crosscode:files-changed", { detail: [file] })
      );
    } catch (error) {
      addToast.error("Failed to bump the build number: " + error);
    }
    // `addToast` gets a new identity on every render (react-toast-plus builds
    // the helpers from scratch), so it must not be a dependency here: that
    // would recreate the callback forever and loop the menu-callbacks effect.
  }, [path]);

  const maxLine = editor?.getModel()?.getLineCount() ?? 0;

  const symbolItems = useMemo<QuickPickItem[]>(() => {
    const model = editor?.getModel();
    if (!openFile || !model) return [];
    return extractSymbols(openFile, model.getValue()).map((symbol, index) => ({
      key: `${symbol.line}:${index}`,
      label: symbol.name,
      glyph: symbolGlyph(symbol.kind),
      detail: `${symbol.kind} · line ${symbol.line}`,
      onSelect: () => openNewFileAt(openFile, symbol.line),
    }));
    // `symbolsPickerOpen` refreshes the list each time the picker opens.
  }, [editor, openFile, openNewFileAt, symbolsPickerOpen]);

  const recentItems = useMemo<QuickPickItem[]>(
    () =>
      recentFiles
        .filter((file) => file !== openFile)
        .slice(0, 100)
        .map((file) => ({
          key: file,
          label: pathBasename(file),
          detail: file,
          onSelect: () => openNewFile(file),
        })),
    [recentFiles, openFile, openNewFile]
  );

  const paletteItems = useMemo<QuickPickItem[]>(
    () => [
      {
        key: "quickOpen",
        label: "Go to File…",
        glyph: "⌘",
        detail: "Ctrl+P",
        onSelect: () => setQuickOpen(true),
      },
      {
        key: "findInProject",
        label: "Find in Project…",
        glyph: "⌕",
        detail: "Ctrl+Shift+F",
        onSelect: () => setProjectSearchOpen(true),
      },
      {
        key: "goToLine",
        label: "Go to Line…",
        glyph: "↦",
        detail: "Ctrl+L",
        onSelect: () => setGoToLineOpen(true),
      },
      {
        key: "goToSymbol",
        label: "Go to Symbol…",
        glyph: "◇",
        detail: "Ctrl+Shift+O",
        onSelect: () => setSymbolsPickerOpen(true),
      },
      {
        key: "recentFiles",
        label: "Open Recent File…",
        glyph: "↺",
        detail: "Ctrl+E",
        onSelect: () => setRecentPickerOpen(true),
      },
      {
        key: "find",
        label: "Find in Current File…",
        glyph: "⌕",
        detail: "Ctrl+F",
        onSelect: () => triggerFind("actions.find"),
      },
      {
        key: "replace",
        label: "Replace in Current File…",
        glyph: "⇄",
        detail: "Ctrl+H",
        onSelect: () =>
          triggerFind("editor.action.startFindReplaceAction"),
      },
      {
        key: "save",
        label: "Save File",
        glyph: "⤓",
        detail: "Ctrl+S",
        onSelect: () => {
          void saveFile?.();
        },
      },
      {
        key: "openFile",
        label: "Open File…",
        glyph: "⌗",
        detail: "Ctrl+O",
        onSelect: () => {
          void selectFile();
        },
      },
      {
        key: "openFolder",
        label: "Open Folder…",
        glyph: "⌂",
        onSelect: () => {
          void openFolderDialog();
        },
      },
      {
        key: "bumpBuild",
        label: "Bump Build Number",
        glyph: "⇧",
        detail: "crosscode.toml",
        onSelect: () => {
          void bumpBuild();
        },
      },
    ],
    [
      saveFile,
      selectFile,
      openFolderDialog,
      bumpBuild,
      triggerFind,
    ]
  );

  useEffect(() => {
    setCallbacks({
      save: saveFile ?? (async () => {}),
      openFolderDialog,
      newProject: () => navigate("/new"),
      welcomePage: () => navigate("/"),
      openFile: selectFile,
      quickOpen: () => setQuickOpen(true),
      deviceSetup: () => setDeviceSetupOpen(true),
      undo: undo ?? (() => {}),
      redo: redo ?? (() => {}),
      find: () => triggerFind("actions.find"),
      replace: () => triggerFind("editor.action.startFindReplaceAction"),
      findInProject: () => setProjectSearchOpen(true),
      goToLine: () => setGoToLineOpen(true),
      goToSymbol: () => setSymbolsPickerOpen(true),
      recentFiles: () => setRecentPickerOpen(true),
      commandPalette: () => setCommandPaletteOpen(true),
      bumpBuild,
    });
  }, [
    saveFile,
    openFolderDialog,
    navigate,
    selectFile,
    undo,
    redo,
    triggerFind,
    bumpBuild,
  ]);

  const mainPaneCount = screenshot ? 3 : 2;
  const initialMainSizes =
    mainSizes.length === mainPaneCount
      ? mainSizes
      : screenshot
        ? [20, 50, 30]
        : [20, 80];
  const initialVerticalSizes =
    verticalSizes.length === 2 ? verticalSizes : [70, 30];

  return (
    <div className="ide-container">
      <MenuBar callbacks={callbacks} editor={editor} />
      <UpdateBanner />
      <QuickOpen
        openFolder={path}
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onOpenFile={openNewFileAt}
        recentFiles={recentFiles}
      />
      <ProjectSearch
        open={projectSearchOpen}
        projectPath={path}
        onClose={() => setProjectSearchOpen(false)}
        onOpenFile={openNewFileAt}
      />
      <QuickPick
        open={symbolsPickerOpen}
        title="Go to Symbol"
        placeholder="Filter symbols in this file…"
        items={symbolItems}
        onClose={() => setSymbolsPickerOpen(false)}
        emptyLabel="No symbols found in this file."
        footer={`${symbolItems.length} symbols`}
      />
      <QuickPick
        open={recentPickerOpen}
        title="Recent Files"
        placeholder="Filter recent files…"
        items={recentItems}
        onClose={() => setRecentPickerOpen(false)}
        emptyLabel="No recent files yet."
        footer={`${recentItems.length} files`}
      />
      <QuickPick
        open={commandPaletteOpen}
        title="Command Palette"
        placeholder="Type a command…"
        items={paletteItems}
        onClose={() => setCommandPaletteOpen(false)}
        footer={`${paletteItems.length} commands`}
      />
      <GoToLineDialog
        open={goToLineOpen}
        maxLine={maxLine}
        onClose={() => setGoToLineOpen(false)}
        onGo={(line) => {
          if (openFile) openNewFileAt(openFile, line);
        }}
      />
      <DeviceWizard
        open={deviceSetupOpen}
        onClose={() => setDeviceSetupOpen(false)}
      />
      <Splitter
        gutterTheme={theme === "dark" ? GutterTheme.Dark : GutterTheme.Light}
        direction={SplitDirection.Horizontal}
        initialSizes={initialMainSizes}
        onResizeFinished={(_, sizes) =>
          setMainSizes(sizes.map((size) => Math.round(size * 100) / 100))
        }
      >
        <Tile className="file-explorer-tile" padded={false}>
          <FileExplorer
            openFolder={path}
            setOpenFile={openNewFile}
            activeFile={openFile}
          />
        </Tile>
        <Splitter
          gutterTheme={theme === "dark" ? GutterTheme.Dark : GutterTheme.Light}
          direction={SplitDirection.Vertical}
          initialSizes={initialVerticalSizes}
          onResizeFinished={(_, sizes) =>
            setVerticalSizes(sizes.map((size) => Math.round(size * 100) / 100))
          }
        >
          <Editor
            openFiles={openFiles}
            focusedFile={openFile}
            setSaveFile={setSaveFile}
            setUndo={setUndo}
            setRedo={setRedo}
            setOpenFiles={setOpenFiles}
            openNewFile={openNewFile}
            setEditorUpper={setEditor}
            reveal={reveal}
            onRevealed={clearReveal}
          />
          <BottomBar onOpenFile={openNewFile} onOpenFileAt={openNewFileAt} />
        </Splitter>
        {screenshot && (
          <div className="screenshot-tile">
            <div>
              <Typography level="h3">Screenshot</Typography>
              <Button
                variant="outlined"
                onClick={async () => {
                  const blob = await (await fetch(screenshot)).blob();
                  const arrayBuffer = await blob.arrayBuffer();
                  const uint8Array = new Uint8Array(arrayBuffer);
                  const savePath = await save({
                    title: "Save Screenshot",
                    defaultPath: "screenshot.png",
                    filters: [
                      { name: "PNG Image", extensions: ["png"] },
                      { name: "All Files", extensions: ["*"] },
                    ],
                  });
                  if (!savePath) return;
                  await writeFile(savePath, uint8Array);
                  addToast.success("Saved screenshot to " + savePath);
                }}
              >
                Save
              </Button>
              <Button variant="outlined" onClick={() => setScreenshot(null)}>
                Close
              </Button>
            </div>
            <div className="screenshot-img-container">
              <img src={screenshot} alt="screenshot" />
            </div>
          </div>
        )}
      </Splitter>
      {initialized &&
        selectedToolchain !== null &&
        projectValidation !== null &&
        projectValidation !== "Valid" && (
          <Modal
            open={true}
            onClose={() => {
              setProjectValidation(null);
            }}
          >
            <ModalDialog sx={{ maxWidth: "90vw" }}>
              <ModalClose />
              <div>
                <div style={{ display: "flex", gap: "var(--padding-sm)" }}>
                  <div style={{ width: "1.25rem" }}>
                    <ErrorIcon />
                  </div>
                  <Typography level="h3">Failed to load project</Typography>
                </div>
                <Typography level="body-lg">
                  {getValidationMsg(projectValidation)} Some features may not
                  work as expected.
                </Typography>
              </div>

              <Divider sx={{ mb: "var(--padding-xs)" }} />
              <div style={{ display: "flex", gap: "var(--padding-lg)" }}>
                {projectValidation === "InvalidToolchain" && <SwiftMenu />}
                {projectValidation !== "InvalidToolchain" && (
                  <>
                    <Button
                      onClick={() => {
                        navigate("/new");
                      }}
                    >
                      Create New
                    </Button>
                    <Button onClick={openFolderDialog}>
                      Open Other Project
                    </Button>
                    <Button
                      onClick={() => {
                        setProjectValidation(null);
                      }}
                      variant="outlined"
                    >
                      Ignore
                    </Button>
                  </>
                )}
              </div>
            </ModalDialog>
          </Modal>
        )}
      {initialized &&
        selectedToolchain !== null &&
        sourcekitStartup === null &&
        hasIgnoredRam === false &&
        hasLimitedRam && (
          <Modal
            open={true}
            onClose={() => {
              setHasIgnoredRam(true);
            }}
          >
            <ModalDialog sx={{ maxWidth: "90vw" }}>
              <ModalClose />
              <div>
                <div style={{ display: "flex", gap: "var(--padding-md)" }}>
                  <div style={{ width: "1.25rem" }}>
                    <WarningIcon />
                  </div>
                  <Typography level="h3">Limited Memory</Typography>
                </div>
                <Typography level="body-lg">
                  SourceKit-LSP is used to provide autocomplete, error
                  reporting, and other language features. However, it uses a
                  large amount of memory. Your device does not meet our
                  recommended memory requirements. You can choose to enable it
                  anyways, but it may cause crashes or instability.
                </Typography>
                <Typography
                  level="body-lg"
                  style={{ marginTop: "var(--padding-sm)" }}
                >
                  You can change this at any time in Edit {">"} Preferences{" "}
                  {">"} SourceKit LSP {">"} Auto-Launch SourceKit.
                </Typography>
                <Typography
                  level="body-lg"
                  style={{ marginTop: "var(--padding-sm)" }}
                >
                  You can also enable SourceKit temporarily with Build {">"}{" "}
                  Restart LSP.
                </Typography>
              </div>

              <Divider sx={{ mb: "var(--padding-xs)" }} />
              <div style={{ display: "flex", gap: "var(--padding-lg)" }}>
                <Button
                  onClick={() => {
                    setSourcekitStartup(false);
                    setHasIgnoredRam(true);
                  }}
                >
                  Keep disabled
                </Button>
                <Button
                  onClick={() => {
                    setSourcekitStartup(true);
                    setHasIgnoredRam(true);
                  }}
                  color="danger"
                  variant="outlined"
                >
                  Enable Anyway
                </Button>
              </div>
            </ModalDialog>
          </Modal>
        )}
      {initialized &&
        selectedToolchain !== null &&
        hasIgnoredDarwinSDK === false &&
        darwinSDKVersion !== DARWIN_SDK_VERSION && (
          <Modal
            open={true}
            onClose={() => {
              setHasIgnoredDarwinSDK(true);
            }}
          >
            <ModalDialog sx={{ maxWidth: "90vw" }}>
              <ModalClose />
              <div>
                <div style={{ display: "flex", gap: "var(--padding-md)" }}>
                  <div style={{ width: "1.25rem" }}>
                    <WarningIcon />
                  </div>
                  <Typography level="h3">Incompatible SDK Version</Typography>
                </div>
                <Typography level="body-lg">
                  This version of CrossCode is designed to work with Darwin SDK{" "}
                  {DARWIN_SDK_VERSION}, but you have version {darwinSDKVersion}{" "}
                  installed. Things may still work, but you will miss out on
                  newer features (like liquid glass) and may run into issues.
                </Typography>
              </div>

              <Divider sx={{ mb: "var(--padding-xs)" }} />
              <div style={{ display: "flex", gap: "var(--padding-lg)" }}>
                <Button
                  onClick={() => {
                    navigate("/#install-sdk");
                  }}
                >
                  Install Correct SDK
                </Button>
                <Button
                  onClick={() => {
                    setHasIgnoredDarwinSDK(true);
                  }}
                  variant="outlined"
                >
                  Ignore
                </Button>
              </div>
            </ModalDialog>
          </Modal>
        )}
    </div>
  );
};

function getValidationMsg(validation: ProjectValidation): string {
  switch (validation) {
    case "Invalid":
      return "This does not appear to be a valid CrossCode project.";
    case "InvalidPackage":
      return "SwiftPM was unable to parse your package. Please check your Package.swift file.";
    case "UnsupportedFormatVersion":
      return "This project uses an unsupported config format version. You may need to update CrossCode.";
    case "InvalidToolchain":
      return "Your Swift toolchain appears to be invalid.";
    default:
      return "";
  }
}

function GoToLineDialog({
  open,
  maxLine,
  onClose,
  onGo,
}: {
  open: boolean;
  maxLine: number;
  onClose: () => void;
  onGo: (line: number) => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const parsed = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 1 &&
    parsed <= maxLine;

  const submit = () => {
    if (!valid) return;
    onClose();
    onGo(Math.round(parsed));
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-label="Go to Line" sx={{ width: 340 }}>
        <Typography level="h4">Go to Line</Typography>
        <Input
          autoFocus
          value={value}
          placeholder={maxLine > 0 ? `1 – ${maxLine}` : "No file open"}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={submit}>
            Go
          </Button>
        </div>
      </ModalDialog>
    </Modal>
  );
}
