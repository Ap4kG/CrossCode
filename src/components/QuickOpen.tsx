import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Input,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalDialog,
  Typography,
} from "@mui/joy";
import * as fs from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import {
  filterFiles,
  isBinaryFile,
  matchSegments,
  parseQuery,
  relativePath,
  shouldIgnoreDirectory,
  type TextSegment,
} from "../utilities/fileSearch";
import { joinPath, isWindowsPath } from "../utilities/paths";

export interface QuickOpenProps {
  openFolder: string;
  open: boolean;
  onClose: () => void;
  onOpenFile: (file: string, line?: number) => void;
  /** Paths of recently opened files, most recent first. */
  recentFiles?: string[];
}

const MAX_INDEXED_FILES = 5000;
const MAX_RESULTS = 50;
const MAX_CONTENT_RESULTS = 100;
const CONTENT_SEARCH_DELAY = 250;

type IndexSignal = { cancelled: boolean };

type SearchHit = { path: string; line: number; text: string };

type ResultRow = {
  key: string;
  path: string;
  line?: number;
  name: string;
  description: string;
  segments?: TextSegment[];
};

async function indexProject(
  root: string,
  signal: IndexSignal
): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [root];

  while (
    queue.length > 0 &&
    files.length < MAX_INDEXED_FILES &&
    !signal.cancelled
  ) {
    const dir = queue.shift()!;

    let entries: Awaited<ReturnType<typeof fs.readDir>>;
    try {
      entries = await fs.readDir(dir);
    } catch (error) {
      // Unreadable directories (permissions, dangling symlinks, ...) should not
      // abort the whole index.
      console.error("Quick open: failed to read directory", dir, error);
      continue;
    }

    for (const entry of entries) {
      if (signal.cancelled || files.length >= MAX_INDEXED_FILES) break;

      if (entry.isDirectory) {
        if (!shouldIgnoreDirectory(entry.name)) {
          queue.push(joinPath(dir, entry.name));
        }
      } else if (!isBinaryFile(entry.name)) {
        files.push(joinPath(dir, entry.name));
      }
    }
  }

  return files;
}

function splitPath(path: string): { name: string; directory: string } {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator === -1) return { name: path, directory: "" };
  return {
    name: path.slice(separator + 1),
    directory: path.slice(0, separator),
  };
}

function Highlight({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <Box
            component="span"
            key={index}
            sx={{ color: "primary.400", fontWeight: "lg" }}
          >
            {segment.text}
          </Box>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

export default ({
  openFolder,
  open,
  onClose,
  onOpenFile,
  recentFiles = [],
}: QuickOpenProps) => {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const [contentHits, setContentHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const indexRef = useRef<{
    folder: string;
    files: string[];
    updated: number;
  } | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const isContentMode = parsed.mode === "content";

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setSelected(0);

    if (
      indexRef.current?.folder === openFolder &&
      Date.now() - indexRef.current.updated < 30_000
    ) {
      setFiles(indexRef.current.files);
      return;
    }

    const signal: IndexSignal = { cancelled: false };
    setLoading(true);
    setFiles([]);

    indexProject(openFolder, signal)
      .then((indexed) => {
        if (signal.cancelled) return;
        indexRef.current = {
          folder: openFolder,
          files: indexed,
          updated: Date.now(),
        };
        setFiles(indexed);
        setLoading(false);
      })
      .catch((error) => {
        if (signal.cancelled) return;
        console.error("Quick open: failed to index project", error);
        setLoading(false);
      });

    return () => {
      signal.cancelled = true;
    };
  }, [open, openFolder]);

  // Content search (`#query`) is delegated to Rust, which walks the project
  // without going through the webview's async file system API.
  useEffect(() => {
    if (!open || !isContentMode) {
      setContentHits([]);
      return;
    }

    const text = parsed.text;
    if (text.length < 2) {
      setContentHits([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await invoke<SearchHit[]>("search_project", {
          projectPath: openFolder,
          query: text,
          limit: MAX_CONTENT_RESULTS,
        });
        if (!cancelled) setContentHits(hits);
      } catch (error) {
        console.error("Quick open: content search failed", error);
        if (!cancelled) setContentHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, CONTENT_SEARCH_DELAY);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, isContentMode, parsed.text, openFolder]);

  const rows = useMemo<ResultRow[]>(() => {
    if (isContentMode) {
      return contentHits.map((hit) => {
        const { name } = splitPath(hit.path);
        return {
          key: `${hit.path}:${hit.line}`,
          path: hit.path,
          line: hit.line,
          name: `${name}:${hit.line}`,
          description: hit.text,
          segments: matchSegments(hit.text, parsed.text),
        };
      });
    }

    return filterFiles(
      files,
      parsed.text,
      openFolder,
      MAX_RESULTS,
      recentFiles
    ).map((file) => {
      const relative = relativePath(openFolder, file);
      const { name, directory } = splitPath(relative);
      return {
        key: file,
        path: file,
        line: parsed.line,
        name,
        description: directory,
        segments: matchSegments(name, parsed.text),
      };
    });
  }, [
    isContentMode,
    contentHits,
    files,
    parsed.text,
    parsed.line,
    openFolder,
    recentFiles,
  ]);

  useEffect(() => {
    setSelected(0);
  }, [parsed.text, parsed.line, isContentMode, files, contentHits]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const openResult = useCallback(
    async (row: ResultRow) => {
      onClose();
      try {
        const absolute = isContentMode ? joinPath(openFolder, row.path) : row.path;
        const target =
          platform() === "windows" && isWindowsPath(absolute)
            ? await invoke<string>("linux_path", { path: absolute })
            : absolute;
        onOpenFile(target, row.line);
      } catch (error) {
        console.error("Quick open: failed to convert path", error);
        onOpenFile(row.path, row.line);
      }
    },
    [isContentMode, openFolder, onClose, onOpenFile]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (row) openResult(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const busy = isContentMode ? searching : loading;
  const emptyLabel = isContentMode
    ? parsed.text.length < 2
      ? "Type at least two characters to search file contents"
      : "No matches in file contents"
    : "No files found";

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: "min(720px, 92vw)",
          padding: 0,
          gap: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            padding: "var(--padding-sm)",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Input
            autoFocus
            placeholder="Search files by name (# to search contents, :42 to jump to a line)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ width: "100%" }}
          />
        </Box>
        <Box sx={{ maxHeight: "50vh", overflowY: "auto" }}>
          {busy && (
            <Box
              sx={{ display: "flex", justifyContent: "center", padding: 2 }}
            >
              <CircularProgress size="sm" />
            </Box>
          )}
          {!busy && rows.length === 0 && (
            <Typography
              level="body-sm"
              sx={{ padding: 2 }}
              textColor="text.tertiary"
            >
              {emptyLabel}
            </Typography>
          )}
          <List size="sm" sx={{ padding: 0 }}>
            {rows.map((row, index) => (
              <ListItem key={row.key} sx={{ padding: 0 }}>
                <ListItemButton
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => openResult(row)}
                  sx={{
                    paddingInline: "var(--padding-sm)",
                    paddingBlock: "var(--padding-xs)",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--padding-sm)",
                  }}
                >
                  <Typography
                    level="body-sm"
                    sx={{
                      fontWeight: index === selected ? "lg" : undefined,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {isContentMode || row.segments === undefined ? (
                      row.name
                    ) : (
                      <Highlight segments={row.segments} />
                    )}
                  </Typography>
                  {isContentMode ? (
                    <Typography
                      level="body-xs"
                      textColor="text.tertiary"
                      sx={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginLeft: "auto",
                        fontFamily: "monospace",
                      }}
                    >
                      {row.segments ? (
                        <Highlight segments={row.segments} />
                      ) : (
                        row.description
                      )}
                    </Typography>
                  ) : (
                    row.description && (
                      <Typography
                        level="body-xs"
                        textColor="text.tertiary"
                        sx={{
                          marginLeft: "auto",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.description}
                      </Typography>
                    )
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
        <Box
          sx={{
            paddingInline: "var(--padding-sm)",
            paddingBlock: "var(--padding-xs)",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: "var(--padding-md)",
          }}
        >
          {isContentMode ? (
            <Chip size="sm" variant="soft" color="primary" sx={{ fontSize: 10 }}>
              content search
            </Chip>
          ) : (
            <Typography level="body-xs" textColor="text.tertiary">
              # contents
            </Typography>
          )}
          <Typography level="body-xs" textColor="text.tertiary">
            ↑↓ navigate
          </Typography>
          <Typography level="body-xs" textColor="text.tertiary">
            Enter open
          </Typography>
          <Typography level="body-xs" textColor="text.tertiary">
            Esc close
          </Typography>
          <Typography
            level="body-xs"
            textColor="text.tertiary"
            sx={{ marginLeft: "auto" }}
          >
            {isContentMode
              ? searching
                ? "searching…"
                : `${contentHits.length} matches`
              : loading
                ? "indexing…"
                : `${files.length} files`}
          </Typography>
        </Box>
      </ModalDialog>
    </Modal>
  );
};
