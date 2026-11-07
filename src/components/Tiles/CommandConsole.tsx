import { useEffect, useRef } from "react";
import "./Console.css";
import { listen } from "@tauri-apps/api/event";
import Convert from "ansi-to-html";
import { Virtuoso } from "react-virtuoso";
import { useIDE } from "../../utilities/IDEContext";
import { escapeHtml } from "./Console";
import { useParams } from "react-router";
import { isWindowsPath, joinPath } from "../../utilities/paths";

const convert = new Convert();

// Built from a char code so the literal never holds a raw control character.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// Swift/clang diagnostics: "path:line:col: error: message".
const DIAGNOSTIC_PATTERN =
  /^\s*(.+?):(\d+)(?::(\d+))?:\s*(error|warning|note|remark):\s*(.*)$/i;

export interface ConsoleDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
}

export function parseConsoleDiagnostic(line: string): ConsoleDiagnostic | null {
  const plain = line.replace(ANSI_ESCAPE, "");
  const match = DIAGNOSTIC_PATTERN.exec(plain);
  if (!match) return null;

  const [, file, lineNumber, column, severity, message] = match;
  if (!file || /^https?:\/\//i.test(file)) return null;

  return {
    file: file.trim(),
    line: Number(lineNumber) || 1,
    column: column ? Number(column) || 1 : 1,
    severity: severity.toLowerCase(),
    message,
  };
}

/** Maps a compiler path (Windows, WSL or project-relative) to an editor path. */
async function resolveDiagnosticFile(
  file: string,
  projectPath?: string
): Promise<string | null> {
  // Absolute paths are passed through untouched: the IDE reuses an already
  // open tab regardless of whether it stores the Windows or WSL form.
  if (isWindowsPath(file) || file.startsWith("/")) return file;
  if (!projectPath) return null;
  return joinPath(projectPath, file);
}

export default function CommandConsole({
  onOpenFileAt,
}: {
  onOpenFileAt?: (file: string, line?: number) => void;
}) {
  const { consoleLines, setConsoleLines } = useIDE();
  const listenerAdded = useRef(false);
  const unlisten = useRef<() => void>(() => {});

  const { path } = useParams<"path">();

  useEffect(() => {
    setConsoleLines([]);
  }, [path]);

  useEffect(() => {
    if (!listenerAdded.current) {
      (async () => {
        const unlistenFn = await listen("build-output", (event) => {
          let line = event.payload as string;
          if (line.includes("command.done")) {
            if (line.split(".")[2] === "999") {
              setConsoleLines((lines) => [...lines, "Command failed"]);
            } else {
              setConsoleLines((lines) => [
                ...lines,
                "Command finished with exit code: " + line.split(".")[2],
              ]);
            }
          } else {
            setConsoleLines((lines) => [...lines, line]);
          }
        });
        unlisten.current = unlistenFn;
      })();
      listenerAdded.current = true;
    }
    return () => {
      unlisten.current();
    };
  }, []);

  return (
    <div className="console-container">
      <Virtuoso
        className="console-tile"
        atBottomThreshold={20}
        followOutput={"auto"}
        data={consoleLines}
        itemContent={(_, line) => {
          const diagnostic = onOpenFileAt
            ? parseConsoleDiagnostic(line)
            : null;

          return (
            <pre
              className={
                "console-line" + (diagnostic ? " is-diagnostic" : "")
              }
              style={{ margin: 0, width: "fit-content", padding: 0 }}
              title={
                diagnostic
                  ? `Open ${diagnostic.file}:${diagnostic.line}`
                  : undefined
              }
              onClick={
                diagnostic && onOpenFileAt
                  ? () => {
                      void resolveDiagnosticFile(diagnostic.file, path).then(
                        (file) => {
                          if (file) onOpenFileAt(file, diagnostic.line);
                        }
                      );
                    }
                  : undefined
              }
              dangerouslySetInnerHTML={{
                __html: convert.toHtml(escapeHtml(line)),
              }}
            />
          );
        }}
      />
    </div>
  );
}
