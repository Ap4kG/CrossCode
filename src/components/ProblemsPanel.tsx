import { useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/joy";
import * as monaco from "monaco-editor";

export interface ProblemsPanelProps {
  onOpenFileAt: (file: string, line: number) => void;
}

type Problem = {
  key: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: number;
};

function severityRank(severity: number): number {
  // Monaco: Hint = 1, Info = 2, Warning = 4, Error = 8.
  if (severity >= monaco.MarkerSeverity.Error) return 0;
  if (severity >= monaco.MarkerSeverity.Warning) return 1;
  if (severity >= monaco.MarkerSeverity.Info) return 2;
  return 3;
}

function severityColor(severity: number): string {
  if (severity >= monaco.MarkerSeverity.Error) return "#f45b5b";
  if (severity >= monaco.MarkerSeverity.Warning) return "#d8a13a";
  if (severity >= monaco.MarkerSeverity.Info) return "#5d9cec";
  return "var(--text-tertiary)";
}

function severityLabel(severity: number): string {
  if (severity >= monaco.MarkerSeverity.Error) return "error";
  if (severity >= monaco.MarkerSeverity.Warning) return "warning";
  if (severity >= monaco.MarkerSeverity.Info) return "info";
  return "hint";
}

/**
 * Reads diagnostics that the language client publishes as Monaco markers.
 * Monaco keeps them for every model, so this also covers files that were
 * closed but analysed by SourceKit-LSP.
 */
function markerFilePath(uri: monaco.Uri): string {
  // VS Code URIs expose a native Windows path as `/c:/Users/...`; tabs use
  // `C:\Users\...`, so convert that form back. WSL paths (`/mnt/c/...`) and
  // POSIX paths are already in the editor's form and stay untouched.
  const drive = /^\/([a-zA-Z]):(?:\/(.*))?$/.exec(uri.path);
  if (!drive) return uri.path;
  const tail = (drive[2] ?? "").replace(/\//g, "\\");
  return `${drive[1].toUpperCase()}:\\${tail}`;
}

function readProblems(): Problem[] {
  const problems: Problem[] = [];

  for (const marker of monaco.editor.getModelMarkers({})) {
    const uri = marker.resource;
    if (!uri || uri.scheme !== "file" || !uri.path) continue;

    problems.push({
      key: `${uri.toString()}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
      file: markerFilePath(uri),
      line: marker.startLineNumber,
      column: marker.startColumn,
      message: marker.message,
      severity: marker.severity,
    });
  }

  return problems.sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
}

export function useProblemCount(): { errors: number; warnings: number } {
  const [counts, setCounts] = useState({ errors: 0, warnings: 0 });

  useEffect(() => {
    const update = () => {
      let errors = 0;
      let warnings = 0;
      for (const problem of readProblems()) {
        if (problem.severity >= monaco.MarkerSeverity.Error) errors++;
        else if (problem.severity >= monaco.MarkerSeverity.Warning) warnings++;
      }
      setCounts((previous) =>
        previous.errors === errors && previous.warnings === warnings
          ? previous
          : { errors, warnings }
      );
    };

    update();
    const disposable = monaco.editor.onDidChangeMarkers(() => update());
    return () => disposable.dispose();
  }, []);

  return counts;
}

function shortPath(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? parts.join("/") : parts.slice(-2).join("/");
}

export default function ProblemsPanel({ onOpenFileAt }: ProblemsPanelProps) {
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    const update = () => setProblems(readProblems());
    update();
    const disposable = monaco.editor.onDidChangeMarkers(() => update());
    return () => disposable.dispose();
  }, []);

  const grouped = useMemo(() => {
    const files = new Map<string, Problem[]>();
    for (const problem of problems) {
      const list = files.get(problem.file);
      if (list) {
        list.push(problem);
      } else {
        files.set(problem.file, [problem]);
      }
    }
    return [...files.entries()];
  }, [problems]);

  if (problems.length === 0) {
    return (
      <Box sx={{ padding: "var(--padding-sm)" }}>
        <Typography level="body-sm" textColor="text.tertiary">
          No problems detected.
        </Typography>
        <Typography level="body-xs" textColor="text.tertiary">
          Diagnostics come from SourceKit-LSP and appear here automatically.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      {grouped.map(([file, fileProblems]) => (
        <Box key={file}>
          <Typography
            level="body-xs"
            sx={{
              paddingInline: "var(--padding-sm)",
              paddingBlock: "2px",
              fontWeight: "lg",
              position: "sticky",
              top: 0,
              backgroundColor: "background.surface",
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
            textColor="text.tertiary"
          >
            {shortPath(file)} · {fileProblems.length}
          </Typography>
          {fileProblems.map((problem) => (
            <Box
              key={problem.key}
              role="button"
              tabIndex={0}
              onClick={() => onOpenFileAt(problem.file, problem.line)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onOpenFileAt(problem.file, problem.line);
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
                sx={{
                  width: 10,
                  flexShrink: 0,
                  color: severityColor(problem.severity),
                }}
                title={severityLabel(problem.severity)}
              >
                ●
              </Typography>
              <Typography
                level="body-xs"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                  flex: 1,
                }}
              >
                {problem.message}
              </Typography>
              <Typography
                level="body-xs"
                textColor="text.tertiary"
                sx={{ flexShrink: 0, fontFamily: "monospace" }}
              >
                {problem.line}:{problem.column}
              </Typography>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
