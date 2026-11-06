import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Input,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalClose,
  ModalDialog,
  Tooltip,
  Typography,
  useColorScheme,
} from "@mui/joy";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { useToast } from "react-toast-plus";
import { isWindowsPath, joinPath } from "../utilities/paths";
import DiffViewer from "./DiffViewer";

type GitFileStatus = {
  path: string;
  status: string;
  code: string;
  staged: boolean;
};

type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
};

type DiffTarget = {
  file: GitFileStatus;
};

export interface GitPanelProps {
  projectPath: string;
  onOpenFile: (file: string) => void;
}

function statusColor(
  status: string
): "success" | "warning" | "danger" | "primary" | "neutral" {
  switch (status) {
    case "Added":
    case "Untracked":
      return "success";
    case "Modified":
      return "warning";
    case "Deleted":
    case "Conflicted":
      return "danger";
    case "Renamed":
    case "Copied":
      return "primary";
    default:
      return "neutral";
  }
}

export default ({ projectPath, onOpenFile }: GitPanelProps) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [filter, setFilter] = useState("");
  const { addToast } = useToast();
  const { mode } = useColorScheme();

  // Guards against out-of-order responses when refresh is triggered repeatedly
  // (window focus, manual refresh, staging a file).
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<GitStatus>("git_status", { projectPath });
      if (requestId !== requestRef.current) return;
      setStatus(result);
    } catch (invokeError) {
      if (requestId !== requestRef.current) return;
      setStatus(null);
      setError(String(invokeError));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Pick up changes made outside CrossCode (terminal, another editor) as soon
  // as the window gets focus again.
  useEffect(() => {
    const onFocus = () => {
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const openFile = useCallback(
    async (relativePath: string) => {
      try {
        const absolute = joinPath(projectPath, relativePath);
        // Only convert when the project itself lives on the host filesystem;
        // projects inside WSL are already addressed with POSIX paths.
        const target =
          platform() === "windows" && isWindowsPath(projectPath)
            ? await invoke<string>("linux_path", { path: absolute })
            : absolute;
        onOpenFile(target);
      } catch (openError) {
        console.error("Failed to open file from git panel:", openError);
      }
    },
    [projectPath, onOpenFile]
  );

  const changeStage = useCallback(
    async (files: string[], unstage: boolean) => {
      if (files.length === 0) return;
      setBusyAll(files.length > 1);
      setBusyFile(files.length === 1 ? files[0] : null);
      try {
        await invoke(unstage ? "git_reset" : "git_add", {
          projectPath,
          files,
        });
        await refresh();
      } catch (stageError) {
        addToast.error(String(stageError));
      } finally {
        setBusyAll(false);
        setBusyFile(null);
      }
    },
    [projectPath, refresh, addToast]
  );

  const commit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setCommitting(true);
    try {
      await invoke<string>("git_commit", {
        projectPath,
        message: trimmed,
        amend,
      });
      setMessage("");
      setAmend(false);
      addToast.success(amend ? "Commit amended" : "Changes committed");
      await refresh();
    } catch (commitError) {
      addToast.error(String(commitError));
    } finally {
      setCommitting(false);
    }
  }, [projectPath, message, amend, refresh, addToast]);

  const staged = useMemo(
    () => status?.files.filter((file) => file.staged) ?? [],
    [status]
  );
  const unstaged = useMemo(
    () => status?.files.filter((file) => !file.staged) ?? [],
    [status]
  );

  const matchesFilter = useCallback(
    (file: GitFileStatus) =>
      filter.trim().length === 0 ||
      file.path.toLowerCase().includes(filter.trim().toLowerCase()),
    [filter]
  );

  const visibleStaged = staged.filter(matchesFilter);
  const visibleUnstaged = unstaged.filter(matchesFilter);

  const renderFile = (file: GitFileStatus) => (
    <ListItem key={`${file.code}:${file.path}`} sx={{ padding: 0 }}>
      <ListItemButton
        onClick={() => openFile(file.path)}
        sx={{
          paddingInline: "var(--padding-sm)",
          paddingBlock: "2px",
          gap: "var(--padding-xs)",
        }}
      >
        <Chip
          size="sm"
          variant="soft"
          color={statusColor(file.status)}
          sx={{ minWidth: 24, fontSize: 10 }}
        >
          {file.code.trim() || "?"}
        </Chip>
        <Typography
          level="body-xs"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          {file.path}
        </Typography>
        <Box
          sx={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            gap: 0.5,
          }}
        >
          <Button
            size="sm"
            variant="plain"
            sx={{ fontSize: 11, minHeight: 22 }}
            onClick={(event) => {
              event.stopPropagation();
              setDiffTarget({ file });
            }}
          >
            Diff
          </Button>
          {busyFile === file.path ? (
            <CircularProgress size="sm" sx={{ width: 18, height: 18 }} />
          ) : (
            <Tooltip title={file.staged ? "Unstage" : "Stage"}>
              <IconButton
                size="sm"
                variant="plain"
                aria-label={file.staged ? "Unstage file" : "Stage file"}
                sx={{ minWidth: 22, minHeight: 22 }}
                onClick={(event) => {
                  event.stopPropagation();
                  changeStage([file.path], file.staged);
                }}
              >
                {file.staged ? (
                  <RemoveIcon fontSize="small" />
                ) : (
                  <AddIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </ListItemButton>
    </ListItem>
  );

  const stagedCount = staged.length;
  const unstagedCount = unstaged.length;

  return (
    <div className="git-panel">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "var(--padding-sm)",
          padding: "var(--padding-xs) var(--padding-sm)",
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 32,
        }}
      >
        <Typography level="body-sm" sx={{ fontWeight: "lg" }}>
          {status?.branch ?? "Git"}
        </Typography>
        {status && status.ahead > 0 && (
          <Chip size="sm" variant="soft" color="neutral">
            ↑{status.ahead}
          </Chip>
        )}
        {status && status.behind > 0 && (
          <Chip size="sm" variant="soft" color="neutral">
            ↓{status.behind}
          </Chip>
        )}
        {status && status.files.length > 0 && (
          <Typography level="body-xs" textColor="text.tertiary">
            {stagedCount} staged · {unstagedCount} changed
          </Typography>
        )}
        <Box sx={{ marginLeft: "auto", display: "flex", gap: 0.5 }}>
          {stagedCount > 0 && (
            <Button
              size="sm"
              variant="plain"
              disabled={busyAll}
              onClick={() => changeStage(staged.map((file) => file.path), true)}
              sx={{ fontSize: 11 }}
            >
              Unstage all
            </Button>
          )}
          <IconButton
            size="sm"
            variant="plain"
            onClick={refresh}
            disabled={loading}
            title="Refresh git status"
            aria-label="Refresh git status"
          >
            {loading ? <CircularProgress size="sm" /> : <RefreshIcon />}
          </IconButton>
        </Box>
      </Box>

      {!loading && error && (
        <Box sx={{ padding: "var(--padding-sm)" }}>
          <Typography level="body-sm" color="danger">
            {error}
          </Typography>
          <Typography level="body-xs" textColor="text.tertiary">
            Make sure git is installed and this project is a git repository.
          </Typography>
          <Button
            size="sm"
            variant="soft"
            onClick={refresh}
            sx={{ marginTop: "var(--padding-xs)" }}
          >
            Retry
          </Button>
        </Box>
      )}

      {!loading && !error && status && status.files.length === 0 && (
        <Box sx={{ padding: "var(--padding-sm)" }}>
          <Typography level="body-sm" textColor="text.tertiary">
            No changes.
          </Typography>
        </Box>
      )}

      {(stagedCount > 0 || unstagedCount > 0) && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "var(--padding-xs)",
            paddingInline: "var(--padding-sm)",
            paddingBlock: "2px",
          }}
        >
          <Input
            size="sm"
            placeholder="Filter files"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            sx={{ flex: 1 }}
            aria-label="Filter changed files"
          />
          {unstagedCount > 0 && (
            <Button
              size="sm"
              variant="plain"
              disabled={busyAll}
              onClick={() =>
                changeStage(unstaged.map((file) => file.path), false)
              }
              sx={{ fontSize: 11, flexShrink: 0 }}
            >
              Stage all
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ overflowY: "auto", flex: 1 }}>
        {visibleStaged.length > 0 && (
          <>
            <Typography
              level="body-xs"
              sx={{
                paddingInline: "var(--padding-sm)",
                paddingBlock: "2px",
                fontWeight: "lg",
                textTransform: "uppercase",
              }}
              textColor="text.tertiary"
            >
              Staged changes
            </Typography>
            <List size="sm" sx={{ padding: 0 }}>
              {visibleStaged.map(renderFile)}
            </List>
          </>
        )}
        {visibleUnstaged.length > 0 && (
          <>
            <Typography
              level="body-xs"
              sx={{
                paddingInline: "var(--padding-sm)",
                paddingBlock: "2px",
                fontWeight: "lg",
                textTransform: "uppercase",
              }}
              textColor="text.tertiary"
            >
              Changes
            </Typography>
            <List size="sm" sx={{ padding: 0 }}>
              {visibleUnstaged.map(renderFile)}
            </List>
          </>
        )}
      </Box>

      {status?.isRepo && !error && (
        <>
          <Divider />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "var(--padding-xs)",
              padding: "var(--padding-xs) var(--padding-sm)",
            }}
          >
            <Checkbox
              size="sm"
              checked={amend}
              onChange={(event) => setAmend(event.target.checked)}
              label="Amend"
              aria-label="Amend the last commit"
              sx={{ flexShrink: 0 }}
            />
            <Input
              size="sm"
              placeholder="Commit message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
              sx={{ flex: 1 }}
              aria-label="Commit message"
            />
            <Button
              size="sm"
              variant="solid"
              loading={committing}
              disabled={
                committing || (!amend && stagedCount === 0) || !message.trim()
              }
              onClick={commit}
              title={
                stagedCount === 0 && !amend
                  ? "Stage some changes first"
                  : amend
                    ? "Replace the last commit"
                    : "Commit staged changes"
              }
            >
              {amend ? "Amend" : "Commit"}
            </Button>
          </Box>
        </>
      )}

      <Modal open={diffTarget !== null} onClose={() => setDiffTarget(null)}>
        <ModalDialog sx={{ width: "min(1100px, 94vw)", maxHeight: "90vh" }}>
          <ModalClose />
          <Typography level="h4">{diffTarget?.file.path}</Typography>
          <Divider />
          {diffTarget && (
            <DiffViewer
              projectPath={projectPath}
              file={diffTarget.file.path}
              staged={diffTarget.file.staged}
              untracked={diffTarget.file.status === "Untracked"}
              dark={mode === "dark"}
            />
          )}
        </ModalDialog>
      </Modal>
    </div>
  );
};
