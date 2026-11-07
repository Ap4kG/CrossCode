import {
  Button,
  Divider,
  Menu,
  MenuItem,
  Modal,
  ModalDialog,
  Input,
  Typography,
  Box,
} from "@mui/joy";
import "./FileExplorer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { path } from "@tauri-apps/api";
import * as fs from "@tauri-apps/plugin-fs";
import { ClickAwayListener } from "@mui/material";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useToast } from "react-toast-plus";
import { basename, joinPath } from "../../utilities/paths";
import { editorPath } from "../../utilities/nativePath";

interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Directories that only add noise to the navigator / filter results. */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".build",
  ".crosscode",
  "DerivedData",
  "node_modules",
]);

/** Clipboard access with a fallback for webviews without the async API. */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(area);
      return copied;
    } catch {
      return false;
    }
  }
}

const sortEntries = (a: FileEntry, b: FileEntry) => {
  if (a.isDirectory && !b.isDirectory) return -1;
  if (!a.isDirectory && b.isDirectory) return 1;
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

/**
 * Windows paths (`C:\Users\...`) and WSL paths (`/mnt/c/Users/...`) reach the
 * navigator through different APIs, so compare them in a single form.
 */
const comparablePath = (value: string) => {
  let normalized = value.replace(/\\/g, "/");
  const wsl = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wsl) normalized = `${wsl[1]}:/${wsl[2]}`;
  return normalized
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
};

const openFileViaPlatform = async (
  filePath: string,
  setOpenFile: (file: string) => void
) => {
  setOpenFile(await editorPath(filePath));
};

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className={"fe-chevron" + (open ? " is-open" : "")}
    viewBox="0 0 12 12"
    aria-hidden="true"
  >
    <path
      d="M4.6 2.8 7.8 6l-3.2 3.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg className="fe-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M1.5 4.05c0-.72.58-1.3 1.3-1.3h3.03c.37 0 .71.15.95.42l.7.83h5.72c.72 0 1.3.58 1.3 1.3v6.45c0 .72-.58 1.3-1.3 1.3H2.8c-.72 0-1.3-.58-1.3-1.3V4.05z"
      fill={open ? "#5CAEF7" : "#4C9DF0"}
    />
    <path
      d="M1.5 6.15h13v5.6c0 .72-.58 1.3-1.3 1.3H2.8c-.72 0-1.3-.58-1.3-1.3v-5.6z"
      fill={open ? "#9DCEFB" : "#8AC3FA"}
    />
  </svg>
);

const SwiftIcon = () => (
  <svg className="fe-icon fe-icon-swift" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#F05138"
      d="M7.508 0c-.287 0-.573 0-.86.002-.241.002-.483.003-.724.01-.132.003-.263.009-.395.015A9.154 9.154 0 0 0 4.348.15 5.492 5.492 0 0 0 2.85.645 5.04 5.04 0 0 0 .645 2.848c-.245.48-.4.972-.495 1.5-.093.52-.122 1.05-.136 1.576a35.2 35.2 0 0 0-.012.724C0 6.935 0 7.221 0 7.508v8.984c0 .287 0 .575.002.862.002.24.005.481.012.722.014.526.043 1.057.136 1.576.095.528.25 1.02.495 1.5a5.03 5.03 0 0 0 2.205 2.203c.48.244.97.4 1.498.495.52.093 1.05.124 1.576.138.241.007.483.009.724.01.287.002.573.002.86.002h8.984c.287 0 .573 0 .86-.002.241-.001.483-.003.724-.01a10.523 10.523 0 0 0 1.578-.138 5.322 5.322 0 0 0 1.498-.495 5.035 5.035 0 0 0 2.203-2.203c.245-.48.4-.972.495-1.5.093-.52.124-1.05.138-1.576.007-.241.009-.481.01-.722.002-.287.002-.575.002-.862V7.508c0-.287 0-.573-.002-.86a33.662 33.662 0 0 0-.01-.724 10.5 10.5 0 0 0-.138-1.576 5.328 5.328 0 0 0-.495-1.5A5.039 5.039 0 0 0 21.152.645 5.32 5.32 0 0 0 19.654.15a10.493 10.493 0 0 0-1.578-.138 34.98 34.98 0 0 0-.722-.01C17.067 0 16.779 0 16.492 0H7.508zm6.035 3.41c4.114 2.47 6.545 7.162 5.549 11.131-.024.093-.05.181-.076.272l.002.001c2.062 2.538 1.5 5.258 1.236 4.745-1.072-2.086-3.066-1.568-4.088-1.043a6.803 6.803 0 0 1-.281.158l-.02.012-.002.002c-2.115 1.123-4.957 1.205-7.812-.022a12.568 12.568 0 0 1-5.64-4.838c.649.48 1.35.902 2.097 1.252 3.019 1.414 6.051 1.311 8.197-.002C9.651 12.73 7.101 9.67 5.146 7.191a10.628 10.628 0 0 1-1.005-1.384c2.34 2.142 6.038 4.83 7.365 5.576C8.69 8.408 6.208 4.743 6.324 4.86c4.436 4.47 8.528 6.996 8.528 6.996.154.085.27.154.36.213.085-.215.16-.437.224-.668.708-2.588-.09-5.548-1.893-7.992z"
    />
  </svg>
);

const DocumentIcon = ({ children }: { children?: React.ReactNode }) => (
  <svg className="fe-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 1.6h5.1l3.3 3.3v9.5H4z"
      fill="#FFFFFF"
      stroke="#B5B5BC"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
    <path
      d="M9.1 1.6v3.3h3.3"
      fill="#EAEAEE"
      stroke="#B5B5BC"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
    {children}
  </svg>
);

const PlistIcon = () => (
  <DocumentIcon>
    <path
      d="M5.6 8.2h5M5.6 10h5M5.6 11.8h5"
      stroke="#9C9CA3"
      strokeWidth="0.8"
      strokeLinecap="round"
    />
  </DocumentIcon>
);

const TextIcon = () => (
  <DocumentIcon>
    <path
      d="M5.4 7.4h5.2M5.4 9.2h5.2M5.4 11h3.4"
      stroke="#9C9CA3"
      strokeWidth="0.7"
      strokeLinecap="round"
    />
  </DocumentIcon>
);

const CodeIcon = () => (
  <DocumentIcon>
    <path
      d="M6.6 7.4 4.9 9.2l1.7 1.8M9.4 7.4l1.7 1.8-1.7 1.8"
      fill="none"
      stroke="#9C9CA3"
      strokeWidth="0.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </DocumentIcon>
);

const ImageIcon = () => (
  <DocumentIcon>
    <circle cx="6.4" cy="7.9" r="0.8" fill="#9C9CA3" />
    <path
      d="M5 12.2l2.3-2.4 1.4 1.4 1-1 1.5 2z"
      fill="#C7C7CE"
      stroke="#9C9CA3"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
  </DocumentIcon>
);

const TypeIcon = ({ name }: { name: string }) => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".swift")) return <SwiftIcon />;
  if (lower.endsWith(".plist") || lower.endsWith(".entitlements"))
    return <PlistIcon />;
  if (/\.(png|jpe?g|gif|heic|svg|pdf|icns)$/.test(lower)) return <ImageIcon />;
  if (/\.(md|txt|rtf|strings)$/.test(lower)) return <TextIcon />;
  if (/\.(json|ya?ml|toml|xml|xcconfig)$/.test(lower)) return <CodeIcon />;
  return <DocumentIcon />;
};

const SearchIcon = () => (
  <svg className="fe-search-icon" viewBox="0 0 14 14" aria-hidden="true">
    <circle
      cx="6.2"
      cy="6.2"
      r="3.9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path
      d="m9.2 9.2 2.6 2.6"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

interface FileItemProps {
  filePath: string;
  isDirectory: boolean;
  depth: number;
  setOpenFile: (file: string) => void;
  openDefault?: boolean;
  refresh?: number;
  activeFile?: string | null;
}

const FileItem: React.FC<FileItemProps> = ({
  filePath,
  isDirectory,
  depth,
  setOpenFile,
  openDefault = false,
  refresh = 0,
  activeFile,
}) => {
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState(openDefault);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const isSelected =
    !isDirectory &&
    activeFile != null &&
    comparablePath(filePath) === comparablePath(activeFile);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setName(basename(filePath));

      if (!isDirectory || !expanded) return;

      try {
        const files = await fs.readDir(filePath);
        const entries = files.map((file) => ({
          path: joinPath(filePath, file.name),
          name: file.name,
          isDirectory: file.isDirectory,
        }));
        if (!cancelled) setChildren(entries.sort(sortEntries));
      } catch (error) {
        console.error("Failed to read file:", filePath, error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, expanded, refresh, isDirectory]);

  useEffect(() => {
    if (!isSelected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const handleOpen = useCallback(async () => {
    await openFileViaPlatform(filePath, setOpenFile);
  }, [filePath, setOpenFile]);

  const handleActivate = () => {
    if (isDirectory) {
      setExpanded((value) => !value);
    } else {
      void handleOpen();
    }
  };

  return (
    <>
      <div
        ref={rowRef}
        className={"fe-row" + (isSelected ? " is-selected" : "")}
        data-path={filePath}
        data-is-folder={isDirectory}
        role="treeitem"
        aria-expanded={isDirectory ? expanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        style={{ paddingLeft: 3 + depth * 14 }}
        onClick={handleActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleActivate();
          }
        }}
      >
        {isDirectory ? (
          <Chevron open={expanded} />
        ) : (
          <span className="fe-chevron-spacer" />
        )}
        {isDirectory ? <FolderIcon open={expanded} /> : <TypeIcon name={name} />}
        <span className="fe-name" title={name}>
          {name}
        </span>
      </div>

      {isDirectory && expanded && (
        <div>
          {children.map((child) => (
            <FileItem
              key={child.path}
              filePath={child.path}
              isDirectory={child.isDirectory}
              depth={depth + 1}
              setOpenFile={setOpenFile}
              refresh={refresh}
              activeFile={activeFile}
            />
          ))}
        </div>
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Filter                                                              */
/* ------------------------------------------------------------------ */

const MAX_RESULTS = 300;

async function collectMatches(
  directory: string,
  query: string,
  cancelled: () => boolean,
  depth = 0
): Promise<FileEntry[]> {
  if (depth > 16 || cancelled()) return [];

  let files: Awaited<ReturnType<typeof fs.readDir>>;
  try {
    files = await fs.readDir(directory);
  } catch {
    return [];
  }

  const entries = files.map((file) => ({
    path: joinPath(directory, file.name),
    name: file.name,
    isDirectory: file.isDirectory,
  }));

  const needle = query.toLowerCase();
  const results: FileEntry[] = [];

  for (const entry of entries.sort(sortEntries)) {
    if (cancelled() || results.length >= MAX_RESULTS) break;

    if (entry.isDirectory) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      results.push(
        ...(await collectMatches(entry.path, query, cancelled, depth + 1))
      );
    } else if (entry.name.toLowerCase().includes(needle)) {
      results.push(entry);
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Navigator                                                           */
/* ------------------------------------------------------------------ */

export interface FileExplorerProps {
  openFolder: string;
  setOpenFile: (file: string) => void;
  activeFile?: string | null;
}

export default ({ openFolder, setOpenFile, activeFile }: FileExplorerProps) => {
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    filePath: string;
    isFolder: boolean;
    isRoot?: boolean;
  } | null>(null);

  const { addToast } = useToast();

  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [searching, setSearching] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [newTarget, setNewTarget] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderValue, setNewFolderValue] = useState("");
  const [newFolderTarget, setNewFolderTarget] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteBasename, setDeleteBasename] = useState("");

  const query = filter.trim();

  useEffect(() => {
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }

    let stopped = false;
    setSearching(true);

    const timer = window.setTimeout(async () => {
      const found = await collectMatches(openFolder, query, () => stopped);
      if (stopped) return;
      setResults(found);
      setSearching(false);
    }, 180);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [query, openFolder, refresh]);

  const handleContextMenu = (event: React.MouseEvent) => {
    const element = event.target as HTMLElement;
    if (!element.closest(".fe-tree")) return;

    const target = element.closest("[data-path]") as HTMLElement | null;
    const filePath = target?.getAttribute("data-path");

    event.preventDefault();
    if (!filePath) {
      // Empty area: offer creating items at the project root.
      setContextMenu({
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
        filePath: openFolder,
        isFolder: true,
        isRoot: true,
      });
      return;
    }

    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      filePath,
      isFolder: target?.getAttribute("data-is-folder") === "true",
    });
  };

  const copyPath = async (relative: boolean) => {
    if (!contextMenu) return;
    const normalizedRoot = openFolder
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    const normalizedPath = contextMenu.filePath.replace(/\\/g, "/");
    const value = relative
      ? normalizedPath.replace(normalizedRoot + "/", "")
      : contextMenu.filePath;

    const copied = await copyToClipboard(value);
    if (copied) {
      addToast.success(relative ? "Copied relative path" : "Copied path");
    } else {
      addToast.error("Failed to copy to the clipboard");
    }
  };

  const handleClose = () => {
    setContextMenu(null);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    try {
      const parent = await path.dirname(renameTarget);
      const newPath = await path.resolve(parent, renameValue);
      await fs.rename(renameTarget, newPath);
      setRenameOpen(false);
      setRenameTarget(null);
      setRenameValue("");
      setRefresh((r) => r + 1);
    } catch (error) {
      addToast.error("Failed to rename: " + error);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fs.remove(deleteTarget, { recursive: true });
      setDeleteOpen(false);
      setDeleteTarget(null);
      setRefresh((r) => r + 1);
    } catch (error) {
      addToast.error("Failed to delete: " + error);
    }
  };

  const handleNewFile = async () => {
    if (!newTarget) return;
    try {
      const newPath = await path.resolve(newTarget, newValue);
      if (await fs.exists(newPath)) {
        addToast.error("File already exists!");
        return;
      }
      await fs.writeTextFile(newPath, "");
      setNewOpen(false);
      setNewTarget(null);
      setNewValue("");
      setRefresh((r) => r + 1);
    } catch (error) {
      addToast.error("Failed to create file: " + error);
    }
  };

  const handleNewFolder = async () => {
    if (!newFolderTarget) return;
    try {
      const newPath = await path.resolve(newFolderTarget, newFolderValue);
      if (await fs.exists(newPath)) {
        addToast.error("Folder already exists!");
        return;
      }
      await fs.mkdir(newPath);
      setNewFolderOpen(false);
      setNewFolderTarget(null);
      setNewFolderValue("");
      setRefresh((r) => r + 1);
    } catch (error) {
      addToast.error("Failed to create folder: " + error);
    }
  };

  return (
    <div className={"file-explorer"} onContextMenu={handleContextMenu}>
      <div className="fe-filter">
        <div className="fe-filter-field">
          <SearchIcon />
          <input
            className="fe-filter-input"
            value={filter}
            placeholder="Filter"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      <div className="fe-tree" role="tree">
        {query ? (
          searching && results.length === 0 ? (
            <div className="fe-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="fe-empty">No Results</div>
          ) : (
            results.map((entry) => {
              const relative = entry.path
                .replace(/\\/g, "/")
                .replace(
                  openFolder.replace(/\\/g, "/").replace(/\/$/, "") + "/",
                  ""
                );
              const isSelected =
                activeFile != null &&
                comparablePath(entry.path) === comparablePath(activeFile);

              return (
                <div
                  key={entry.path}
                  className={"fe-row" + (isSelected ? " is-selected" : "")}
                  data-path={entry.path}
                  data-is-folder={false}
                  role="treeitem"
                  tabIndex={0}
                  style={{ paddingLeft: 3 }}
                  onClick={() => {
                    void openFileViaPlatform(entry.path, setOpenFile);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openFileViaPlatform(entry.path, setOpenFile);
                    }
                  }}
                >
                  <span className="fe-chevron-spacer" />
                  <TypeIcon name={entry.name} />
                  <span className="fe-name" title={entry.path}>
                    {entry.name}
                  </span>
                  <span className="fe-row-path">{relative}</span>
                </div>
              );
            })
          )
        ) : (
          <FileItem
            filePath={openFolder}
            isDirectory={true}
            depth={0}
            setOpenFile={setOpenFile}
            openDefault={true}
            refresh={refresh}
            activeFile={activeFile}
          />
        )}
      </div>

      <ClickAwayListener onClickAway={handleClose}>
        <Menu
          size="sm"
          open={contextMenu !== null}
          onClose={handleClose}
          anchorEl={
            contextMenu !== null
              ? ({
                  getBoundingClientRect: () =>
                    ({
                      top: contextMenu.mouseY,
                      left: contextMenu.mouseX,
                      right: contextMenu.mouseX,
                      bottom: contextMenu.mouseY,
                      width: 0,
                      height: 0,
                    } as DOMRect),
                } as any)
              : undefined
          }
          placement="bottom-start"
          sx={{
            pt: 0,
            pb: 0,
          }}
        >
          {contextMenu?.isFolder && (
            <MenuItem
              onClick={async () => {
                handleClose();
                setNewTarget(contextMenu!.filePath);
                setNewValue("");
                setNewOpen(true);
              }}
            >
              New File...
            </MenuItem>
          )}
          {contextMenu?.isFolder && (
            <MenuItem
              onClick={async () => {
                handleClose();
                setNewFolderTarget(contextMenu!.filePath);
                setNewFolderValue("");
                setNewFolderOpen(true);
              }}
            >
              New Folder...
            </MenuItem>
          )}
          {contextMenu?.isFolder && <Divider />}
          {!contextMenu?.isRoot && (
            <MenuItem
              onClick={async () => {
                handleClose();
                await revealItemInDir(contextMenu!.filePath);
              }}
            >
              Open Containing Folder
            </MenuItem>
          )}
          <MenuItem
            onClick={async () => {
              handleClose();
              await copyPath(false);
            }}
          >
            Copy Path
          </MenuItem>
          <MenuItem
            onClick={async () => {
              handleClose();
              await copyPath(true);
            }}
          >
            Copy Relative Path
          </MenuItem>
          {!contextMenu?.isRoot && <Divider />}
          {!contextMenu?.isRoot && (
            <MenuItem
              onClick={async () => {
                handleClose();
                setRenameTarget(contextMenu!.filePath);
                setRenameValue(basename(contextMenu!.filePath));
                setRenameOpen(true);
              }}
            >
              Rename...
            </MenuItem>
          )}
          {!contextMenu?.isRoot && (
            <MenuItem
              onClick={async () => {
                handleClose();
                setDeleteTarget(contextMenu!.filePath);
                setDeleteBasename(basename(contextMenu!.filePath));
                setDeleteOpen(true);
              }}
            >
              Delete
            </MenuItem>
          )}
          <Divider />
          <MenuItem
            onClick={async () => {
              handleClose();
              setRefresh((r) => r + 1);
            }}
          >
            Refresh
          </MenuItem>
        </Menu>
      </ClickAwayListener>

      {/* New File Modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)}>
        <ModalDialog>
          <Typography level="h4" component="h2" sx={{ mb: 2 }}>
            New File
          </Typography>
          <Input
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                await handleNewFile();
              }
            }}
          />
          <Box
            sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}
          >
            <Button onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={handleNewFile} disabled={!newValue.trim()}>
              Create
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

      {/* New Folder Modal */}
      <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)}>
        <ModalDialog>
          <Typography level="h4" component="h2" sx={{ mb: 2 }}>
            New Folder
          </Typography>
          <Input
            autoFocus
            value={newFolderValue}
            onChange={(e) => setNewFolderValue(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                await handleNewFolder();
              }
            }}
          />
          <Box
            sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}
          >
            <Button onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleNewFolder} disabled={!newFolderValue.trim()}>
              Create
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

      {/* Rename Modal */}
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)}>
        <ModalDialog>
          <Typography level="h4" component="h2" sx={{ mb: 2 }}>
            Rename
          </Typography>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                await handleRename();
              }
            }}
          />
          <Box
            sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}
          >
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>
              Rename
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <ModalDialog>
          <Typography level="h4" component="h2" sx={{ mb: 2 }}>
            Confirm Delete
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Are you sure you want to delete <b>{deleteBasename}</b>? This action
            cannot be undone.
          </Typography>
          <Box
            sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}
          >
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button color="danger" onClick={handleDelete}>
              Delete
            </Button>
          </Box>
        </ModalDialog>
      </Modal>
    </div>
  );
};
