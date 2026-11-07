import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Input,
  Modal,
  ModalDialog,
  Typography,
} from "@mui/joy";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ask } from "@tauri-apps/plugin-dialog";
import { useToast } from "react-toast-plus";
import { joinPath } from "../utilities/paths";
import { nativePath } from "../utilities/nativePath";

export interface ProjectSearchProps {
  open: boolean;
  projectPath: string;
  onClose: () => void;
  onOpenFile: (file: string, line: number) => void;
}

type SearchHit = { path: string; line: number; text: string };

const MAX_RESULTS = 400;
const SEARCH_DELAY = 220;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces `query` in `text`, honouring the case-sensitivity toggle. */
export function replaceOccurrences(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean
): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  const flags = matchCase ? "g" : "gi";
  const regex = new RegExp(escapeRegExp(query), flags);
  let count = 0;
  const next = text.replace(regex, () => {
    count++;
    return replacement;
  });
  return { text: next, count };
}

export default function ProjectSearch({
  open,
  projectPath,
  onClose,
  onOpenFile,
}: ProjectSearchProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const { addToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setReplacement("");
    setHits([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const text = matchCase ? query.trim() : query.trim().toLowerCase();
    if (text.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await invoke<SearchHit[]>("search_project", {
          projectPath,
          query: text,
          limit: MAX_RESULTS,
        });
        // The backend always searches case-insensitively, so "Match case"
        // narrows the returned hits here.
        const needle = query.trim();
        if (!cancelled) {
          setHits(
            matchCase
              ? result.filter((hit) => hit.text.includes(needle))
              : result
          );
        }
      } catch (error) {
        console.error("Project search failed:", error);
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DELAY);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, projectPath, query, matchCase]);

  const grouped = useMemo(() => {
    const files = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const list = files.get(hit.path);
      if (list) {
        list.push(hit);
      } else {
        files.set(hit.path, [hit]);
      }
    }
    return [...files.entries()];
  }, [hits]);

  const replaceInFiles = useCallback(
    async (paths: string[]) => {
      const text = query.trim();
      if (text.length < 2 || paths.length === 0) return;

      const confirmed = await ask(
        `Replace ${hits.length} occurrence${hits.length === 1 ? "" : "s"} of "${text}" with "${replacement}"?`,
        { title: "Replace in Project" }
      );
      if (!confirmed) return;

      setReplacing(true);
      let filesChanged = 0;
      let replacements = 0;
      let skipped = 0;
      const changedAbsolute: string[] = [];

      try {
        for (const relative of paths) {
          const absolute = joinPath(projectPath, relative);
          try {
            const native = await nativePath(absolute);
            const source = await readTextFile(native);
            const result = replaceOccurrences(
              source,
              text,
              replacement,
              matchCase
            );
            if (result.count === 0) {
              skipped++;
              continue;
            }
            await writeTextFile(native, result.text);
            filesChanged++;
            replacements += result.count;
            changedAbsolute.push(absolute);
          } catch (error) {
            console.error("Failed to replace in", relative, error);
            skipped++;
          }
        }

        // Open editors hold their own buffer; reload the changed files so the
        // next save does not write the old content back.
        if (changedAbsolute.length > 0) {
          window.dispatchEvent(
            new CustomEvent("crosscode:files-changed", {
              detail: changedAbsolute,
            })
          );
        }

        if (replacements > 0) {
          addToast.success(
            `Replaced ${replacements} occurrence${replacements === 1 ? "" : "s"} in ${filesChanged} file${filesChanged === 1 ? "" : "s"}`
          );
        } else {
          addToast.error("Nothing to replace.");
        }
        if (skipped > 0) {
          addToast.error(
            `${skipped} file${skipped === 1 ? "" : "s"} could not be updated.`
          );
        }
      } finally {
        setReplacing(false);
      }
    },
    [query, replacement, matchCase, hits.length, projectPath, addToast]
  );

  const busy = searching || replacing;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        aria-label="Find in Project"
        sx={{
          width: "min(860px, 94vw)",
          maxHeight: "82vh",
          padding: 0,
          gap: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            padding: "var(--padding-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--padding-xs)",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", gap: "var(--padding-xs)" }}>
            <Input
              size="sm"
              autoFocus
              slotProps={{ input: { ref: inputRef } }}
              placeholder="Find in project…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onClose();
              }}
              sx={{ flex: 1 }}
            />
            <Checkbox
              size="sm"
              label="Match case"
              checked={matchCase}
              onChange={(event) => setMatchCase(event.target.checked)}
              sx={{ flexShrink: 0 }}
            />
          </Box>
          <Box sx={{ display: "flex", gap: "var(--padding-xs)" }}>
            <Input
              size="sm"
              placeholder="Replace with…"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="outlined"
              disabled={
                busy || hits.length === 0 || query.trim().length < 2
              }
              onClick={() =>
                replaceInFiles(grouped.map(([file]) => file))
              }
            >
              Replace All
            </Button>
          </Box>
        </Box>

        <Box sx={{ overflowY: "auto", flex: 1, minHeight: 120 }}>
          {busy && (
            <Box sx={{ display: "flex", justifyContent: "center", padding: 2 }}>
              <CircularProgress size="sm" />
            </Box>
          )}
          {!busy && query.trim().length < 2 && (
            <Typography
              level="body-sm"
              sx={{ padding: 2 }}
              textColor="text.tertiary"
            >
              Type at least two characters to search the whole project.
            </Typography>
          )}
          {!busy && query.trim().length >= 2 && hits.length === 0 && (
            <Typography
              level="body-sm"
              sx={{ padding: 2 }}
              textColor="text.tertiary"
            >
              No matches.
            </Typography>
          )}

          {grouped.map(([file, fileHits]) => (
            <Box key={file}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--padding-xs)",
                  paddingInline: "var(--padding-sm)",
                  paddingBlock: "2px",
                  position: "sticky",
                  top: 0,
                  backgroundColor: "background.surface",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Button
                  size="sm"
                  variant="plain"
                  sx={{ fontSize: 11, minHeight: 22 }}
                  onClick={() => onOpenFile(joinPath(projectPath, file), 1)}
                >
                  {file}
                </Button>
                <Typography level="body-xs" textColor="text.tertiary">
                  {fileHits.length}
                </Typography>
                {replacement !== "" && (
                  <Button
                    size="sm"
                    variant="plain"
                    sx={{ fontSize: 11, minHeight: 22, marginLeft: "auto" }}
                    disabled={busy}
                    onClick={() => replaceInFiles([file])}
                  >
                    Replace in file
                  </Button>
                )}
              </Box>
              {fileHits.map((hit) => (
                <Box
                  key={`${hit.path}:${hit.line}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onOpenFile(joinPath(projectPath, hit.path), hit.line)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onOpenFile(joinPath(projectPath, hit.path), hit.line);
                    }
                  }}
                  sx={{
                    display: "flex",
                    gap: "var(--padding-sm)",
                    alignItems: "baseline",
                    paddingInline: "var(--padding-sm)",
                    paddingBlock: "1px",
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "background.level1" },
                  }}
                >
                  <Typography
                    level="body-xs"
                    textColor="text.tertiary"
                    sx={{
                      width: 44,
                      flexShrink: 0,
                      textAlign: "right",
                      fontFamily: "monospace",
                    }}
                  >
                    {hit.line}
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{
                      fontFamily: "monospace",
                      whiteSpace: "pre",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {hit.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>

        <Box
          sx={{
            paddingInline: "var(--padding-sm)",
            paddingBlock: "var(--padding-xs)",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            gap: "var(--padding-md)",
          }}
        >
          <Typography level="body-xs" textColor="text.tertiary">
            Click a result to jump to the line
          </Typography>
          <Typography
            level="body-xs"
            textColor="text.tertiary"
            sx={{ marginLeft: "auto" }}
          >
            {searching
              ? "searching…"
              : `${hits.length} match${hits.length === 1 ? "" : "es"} in ${grouped.length} file${grouped.length === 1 ? "" : "s"}`}
          </Typography>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
