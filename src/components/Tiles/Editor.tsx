import { path } from "@tauri-apps/api";
import "./Editor.css";
import { IconButton, useColorScheme } from "@mui/joy";
import {
  Dispatch,
  Fragment,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CloseIcon from "@mui/icons-material/Close";
import CircleIcon from "@mui/icons-material/Circle";
import * as monaco from "monaco-editor";
import { initialize, ITextEditorOptions } from "@codingame/monaco-vscode-api";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getTextMateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getEditorServiceOverride from "@codingame/monaco-vscode-editor-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import "@codingame/monaco-vscode-swift-default-extension";
import "@codingame/monaco-vscode-json-default-extension";
import "@codingame/monaco-vscode-xml-default-extension";
import "@codingame/monaco-vscode-yaml-default-extension";
import "@codingame/monaco-vscode-ini-default-extension";
import "@codingame/monaco-vscode-markdown-basics-default-extension";
import "@codingame/monaco-vscode-shellscript-default-extension";
import "@codingame/monaco-vscode-git-base-default-extension";
import "@codingame/monaco-vscode-docker-default-extension";
import "@codingame/monaco-vscode-javascript-default-extension";
import "@codingame/monaco-vscode-typescript-basics-default-extension";
import "@codingame/monaco-vscode-css-default-extension";
import "@codingame/monaco-vscode-html-default-extension";
import "@codingame/monaco-vscode-objective-c-default-extension";
import "@codingame/monaco-vscode-cpp-default-extension";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import { platform } from "@tauri-apps/plugin-os";
import { TabLike } from "../TabLike";
import { useStore } from "../../utilities/StoreContext";
import {
  DEFAULT_EDITOR_FONT,
  normalizeEditorFont,
} from "../../preferences/pages/editor";
import { useParams } from "react-router";
import { readTextFile, writeTextFile, readFile } from "@tauri-apps/plugin-fs";
import {
  isLightTheme,
  resolveEditorTheme,
  setEditorTheme,
} from "../../utilities/xcodeTheme";
import { basename } from "../../utilities/paths";
import { isImageFile, imageMimeType } from "../../utilities/fileSearch";
import { nativePath } from "../../utilities/nativePath";
import { registerTomlLanguage } from "../../utilities/tomlLanguage";
import QuickPick from "../QuickPick";
import {
  extractSymbols,
  symbolGlyph,
  type FileSymbol,
} from "../../utilities/symbols";

export type WorkerLoader = () => Worker;
const workerLoaders: Partial<Record<string, WorkerLoader>> = {
  TextEditorWorker: () =>
    new Worker(
      new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
      { type: "module" }
    ),
  TextMateWorker: () =>
    new Worker(
      new URL(
        "@codingame/monaco-vscode-textmate-service-override/worker",
        import.meta.url
      ),
      { type: "module" }
    ),
};

window.MonacoEnvironment = {
  getWorker: function (_workerId, label) {
    const workerFactory = workerLoaders[label];
    if (workerFactory != null) {
      return workerFactory();
    }
    throw new Error(`Worker ${label} not found`);
  },
};

// TOML has no VS Code default extension; register our grammar alongside the
// bundled language extensions.
void registerTomlLanguage();

export interface EditorProps {
  openFiles: string[];
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  focusedFile: string | null;
  setSaveFile: Dispatch<SetStateAction<(() => Promise<void>) | null>>;
  setUndo: Dispatch<SetStateAction<(() => void) | null>>;
  setRedo: Dispatch<SetStateAction<(() => void) | null>>;
  openNewFile: (file: string) => void;
  setEditorUpper: Dispatch<
    SetStateAction<monaco.editor.IStandaloneCodeEditor | null>
  >;
  /** Requests the editor to reveal a 1-based line once `file` is focused. */
  reveal?: { file: string; line: number } | null;
  /** Called after the reveal request has been handled. */
  onRevealed?: () => void;
}

let globalInitialized = false;
let globalEditorServiceCallbacks = {
  currentTabsRef: { current: [] as { name: string; file: string }[] },
  setFocusedRef: { current: (() => {}) as any },
  openNewFileRef: { current: (() => {}) as any },
  editorRef: { current: null as monaco.editor.IStandaloneCodeEditor | null },
  selectionOverrideRef: { current: null as ITextEditorOptions | null },
};

export default ({
  openFiles,
  focusedFile,
  setSaveFile,
  setUndo,
  setRedo,
  setOpenFiles,
  openNewFile,
  setEditorUpper,
  reveal,
  onRevealed,
}: EditorProps) => {
  const [tabs, setTabs] = useState<
    {
      name: string;
      file: string;
    }[]
  >([]);
  const [unsavedFiles, setUnsavedFiles] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(
    null
  );

  const [focused, setFocused] = useState<number>();
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Status bar mirrors Xcode's: language, caret, selection, indentation, EOL.
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [selectionLength, setSelectionLength] = useState(0);
  const [modelInfo, setModelInfo] = useState({
    language: "plaintext",
    tabSize: 4,
    insertSpaces: true,
    eol: "LF",
  });
  const [symbols, setSymbols] = useState<FileSymbol[]>([]);
  const [symbolsOpen, setSymbolsOpen] = useState(false);

  const { mode } = useColorScheme();

  const monacoEl = useRef(null);
  const [initialized, setInitialized] = useState(false);
  const currentTabsRef = useRef(tabs);
  const setFocusedRef = useRef(setFocused);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const openNewFileRef = useRef(openNewFile);
  const selectionOverrideRef = useRef<ITextEditorOptions | null>(null);
  const hasInitializedRef = useRef(false);
  const scrollStates = useRef<{
    [key: string]: [number, number];
  }>({});
  const [hoveredOnBtn, setHoveredOnBtn] = useState<number | null>(null);
  const [formatOnSave] = useStore<boolean>("sourcekit/format", true);
  const [autosave] = useStore<boolean>("sourcekit/autosave", false);
  const [editorThemePref] = useStore<string>("editor/theme", "auto");
  const [editorFontSize] = useStore<number>("editor/font-size", 13);
  const [storedFontFamily] = useStore<string>(
    "editor/font-family",
    DEFAULT_EDITOR_FONT
  );
  // Pre-0.1.5 installs stored the old stack; keep the picker and the editor in
  // sync by upgrading it on read.
  const editorFontFamily = normalizeEditorFont(storedFontFamily);
  const [editorLigatures] = useStore<boolean>("editor/ligatures", false);
  const autosaveTimer = useRef<number | null>(null);
  const symbolsTimer = useRef<number | null>(null);

  const resolvedTheme = resolveEditorTheme(editorThemePref, mode);
  const editorFontSizeValue = Math.min(
    24,
    Math.max(9, Number(editorFontSize) || 13)
  );

  const { path: filePath } = useParams<"path">();
  const hasAttemptedToReadOpenFiles = useRef<string | null>(null);

  const activeTab = focused !== undefined ? tabs[focused] : undefined;
  const activeFile = activeTab?.file;
  const activeIsImage = activeFile ? isImageFile(activeFile) : false;

  const jumpToLine = (line: number, column = 1) => {
    const model = editor?.getModel();
    if (!editor || !model) return;
    const lineNumber = Math.min(Math.max(1, line), model.getLineCount());
    editor.setPosition({ lineNumber, column });
    editor.revealLineInCenter(lineNumber);
    editor.focus();
  };

  // The symbol containing the caret, like Xcode's last jump-bar segment.
  const currentSymbol = useMemo(() => {
    let active: FileSymbol | null = null;
    for (const symbol of symbols) {
      if (symbol.line > cursor.line) break;
      active = symbol;
    }
    return active;
  }, [symbols, cursor.line]);

  const symbolItems = useMemo(
    () =>
      symbols.map((symbol, index) => ({
        key: `${symbol.line}:${index}`,
        label: symbol.name,
        glyph: symbolGlyph(symbol.kind),
        detail: `${symbol.kind} · line ${symbol.line}`,
        onSelect: () => jumpToLine(symbol.line),
      })),
    [symbols, editor]
  );

  // Xcode-style jump bar: project › folder › file, relative to the project root.
  const breadcrumbs = useMemo(() => {
    const file = focused !== undefined ? tabs[focused]?.file : undefined;
    if (!file) return [] as string[];

    const normalize = (value: string) => value.replace(/\\/g, "/");
    const fileSegments = normalize(file).split("/").filter(Boolean);

    if (filePath) {
      const rootSegments = normalize(filePath).replace(/\/+$/, "").split("/");
      const projectName = rootSegments[rootSegments.length - 1];

      if (projectName) {
        // Paths may differ by drive letter or by WSL mounts (/mnt/c/...), so
        // anchor on the project folder name instead of comparing prefixes.
        const index = fileSegments
          .map((segment) => segment.toLowerCase())
          .lastIndexOf(projectName.toLowerCase());

        return index === -1
          ? [projectName, ...fileSegments]
          : [projectName, ...fileSegments.slice(index + 1)];
      }
    }

    return fileSegments;
  }, [tabs, focused, filePath]);

  useEffect(() => {
    (async () => {
      if (!filePath || hasAttemptedToReadOpenFiles.current === filePath) return;
      const savePath = await path.join(
        filePath,
        ".crosscode",
        "openFiles.json"
      );
      try {
        let text = await readTextFile(savePath);
        if (!text) return;
        let data = JSON.parse(text) as { files: string[]; focused: number };
        if (
          !data ||
          typeof data !== "object" ||
          !Array.isArray(data.files) ||
          typeof data.focused !== "number"
        )
          return;
        data.files = data.files.filter((file) => typeof file === "string");
        if (data.files.length === 0) return;
        if (data.focused < 0 || data.focused >= data.files.length) {
          data.focused = 0;
        }
        setOpenFiles(data.files);
        setTimeout(() => {
          setFocused(data.focused);
        }, 100);
      } catch (e) {
        void e;
      } finally {
        hasAttemptedToReadOpenFiles.current = filePath;
      }
    })();
  }, [filePath, setOpenFiles, setFocused]);

  useEffect(() => {
    (async () => {
      if (!filePath || hasAttemptedToReadOpenFiles.current !== filePath) return;
      const savePath = await path.join(
        filePath,
        ".crosscode",
        "openFiles.json"
      );
      let data = {
        files: openFiles,
        focused: focused ?? 0,
      };
      writeTextFile(savePath, JSON.stringify(data)).catch((err) => {
        console.error("Error writing openFiles.json:", err);
      });
    })();
  }, [openFiles, filePath, focused]);

  useEffect(() => {
    globalEditorServiceCallbacks.currentTabsRef = currentTabsRef;
    globalEditorServiceCallbacks.setFocusedRef = setFocusedRef;
    globalEditorServiceCallbacks.editorRef = editorRef;
    globalEditorServiceCallbacks.openNewFileRef = openNewFileRef;
    globalEditorServiceCallbacks.selectionOverrideRef = selectionOverrideRef;
  });

  useEffect(() => {
    editorRef.current = editor;
    setEditorUpper(editor);
  }, [editor]);

  useEffect(() => {
    currentTabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    setFocusedRef.current = setFocused;
  }, [setFocused]);

  useEffect(() => {
    openNewFileRef.current = openNewFile;
  }, [openNewFile]);

  useEffect(() => {
    const initializeEditor = async () => {
      if (globalInitialized && !hasInitializedRef.current) {
        setInitialized(true);
        hasInitializedRef.current = true;
        return;
      }

      globalInitialized = true;
      await initialize({
        ...getTextMateServiceOverride(),
        ...getThemeServiceOverride(),
        ...getLanguagesServiceOverride(),
        ...getEditorServiceOverride((modelRef, options) => {
          return new Promise((resolve) => {
            if (!globalEditorServiceCallbacks.editorRef.current)
              return resolve(undefined);

            let path =
              platform() === "windows"
                ? modelRef.object.textEditorModel.uri.path
                : modelRef.object.textEditorModel.uri.fsPath;

            if (!path) return resolve(undefined);
            let tabIndex =
              globalEditorServiceCallbacks.currentTabsRef.current.findIndex(
                (tab) => tab.file === path
              );
            if (options !== undefined) {
              const opts = options as ITextEditorOptions | undefined;
              if (opts?.selection) {
                globalEditorServiceCallbacks.selectionOverrideRef.current =
                  opts;
              }
            }
            if (tabIndex === -1) {
              globalEditorServiceCallbacks.openNewFileRef.current(path);
            } else {
              globalEditorServiceCallbacks.setFocusedRef.current(tabIndex);
            }

            resolve(undefined);
          });
        }),
        ...getModelServiceOverride(),
      });
      setInitialized(true);
      hasInitializedRef.current = true;
    };

    initializeEditor();
  }, []);

  useEffect(() => {
    if (focusedFile !== null) {
      let i = openFiles.indexOf(focusedFile);
      if (i === -1 || focused === i) return;
      setFocused(i);
    }
  }, [focusedFile, openFiles]);

  useEffect(() => {
    const fetchTabNames = async () => {
      setTabs(
        openFiles.map((file) => ({
          name: basename(file),
          file,
        }))
      );
    };

    fetchTabNames();
  }, [openFiles]);

  useEffect(() => {
    if (!monacoEl.current || editor || !initialized) return;

    const newEditor = monaco.editor.create(monacoEl.current, {
      value: "",
      language: "plaintext",
      // Closer to Xcode's editor defaults than Monaco's.
      fontFamily: editorFontFamily,
      fontSize: editorFontSizeValue,
      lineHeight: Math.round(editorFontSizeValue * 1.55),
      fontLigatures: editorLigatures,
      letterSpacing: 0.2,
      minimap: { enabled: false },
      glyphMargin: false,
      lineNumbersMinChars: 4,
      folding: true,
      showFoldingControls: "always",
      renderLineHighlight: "line",
      renderLineHighlightOnlyWhenFocus: true,
      renderWhitespace: "selection",
      stickyScroll: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true,
        highlightActiveIndentation: true,
      },
      bracketPairColorization: { enabled: true },
      matchBrackets: "always",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      cursorWidth: 2,
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 11,
        horizontalScrollbarSize: 11,
        useShadows: false,
        alwaysConsumeMouseWheel: false,
      },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      detectIndentation: true,
      tabSize: 4,
      insertSpaces: true,
      formatOnPaste: true,
      autoIndent: "full",
      roundedSelection: true,
      mouseWheelZoom: true,
    });

    setUndo(() => () => {
      newEditor.trigger("keyboard", "undo", null);
    });

    setRedo(() => () => {
      newEditor.trigger("keyboard", "redo", null);
    });

    setEditor(newEditor);

    return () => {
      newEditor.dispose();
    };
  }, [initialized]);

  useEffect(() => {
    if (editor === null) return;
    let listener = editor.onDidScrollChange((e) => {
      if (focused !== undefined) {
        scrollStates.current[tabs[focused].file] = [e.scrollTop, e.scrollLeft];
      }
    });
    return () => {
      listener.dispose();
    };
  }, [editor, focused, tabs]);

  useEffect(() => {
    if (!editor || !initialized) return;
    void setEditorTheme(resolvedTheme, isLightTheme(resolvedTheme));
  }, [resolvedTheme, editor, initialized, openFiles]);

  // Image tabs are previews, not text models: load the bytes and hand them to
  // the browser through an object URL (no asset-protocol config needed).
  useEffect(() => {
    setImageUrl(null);
    setImageError(null);
    if (!activeIsImage || !activeFile) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const bytes = await readFile(await nativePath(activeFile));
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: imageMimeType(activeFile) })
        );
        setImageUrl(objectUrl);
      } catch (error) {
        if (!cancelled) setImageError(String(error));
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeFile, activeIsImage]);

  useEffect(() => {
    if (!editor || activeIsImage) return;
    requestAnimationFrame(() => editor.layout());
  }, [editor, activeIsImage]);

  useEffect(() => {
    if (!editor) return;
    editor.updateOptions({
      fontFamily: editorFontFamily,
      fontSize: editorFontSizeValue,
      lineHeight: Math.round(editorFontSizeValue * 1.55),
      fontLigatures: editorLigatures,
    });
  }, [editor, editorFontFamily, editorFontSizeValue, editorLigatures]);

  // Keep the status bar and the symbol list in sync with the active model.
  useEffect(() => {
    if (!editor) return;
    const file = tabs[focused ?? -1]?.file ?? "";

    const updateModelInfo = () => {
      const model = editor.getModel();
      if (!model) return;
      const options = model.getOptions();
      setModelInfo({
        language: model.getLanguageId(),
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
        eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
      });
    };

    const updateSymbols = () => {
      const model = editor.getModel();
      setSymbols(model && file ? extractSymbols(file, model.getValue()) : []);
    };

    const scheduleSymbols = () => {
      if (symbolsTimer.current !== null) {
        window.clearTimeout(symbolsTimer.current);
      }
      symbolsTimer.current = window.setTimeout(() => {
        symbolsTimer.current = null;
        updateSymbols();
      }, 250);
    };

    const updateCursor = () => {
      const position = editor.getPosition();
      if (position) {
        setCursor({ line: position.lineNumber, column: position.column });
      }
    };

    const updateSelection = () => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      setSelectionLength(
        model && selection ? model.getValueInRange(selection).length : 0
      );
    };

    updateModelInfo();
    updateSymbols();
    updateCursor();
    updateSelection();

    const disposables = [
      // The model is attached asynchronously after the tab switches, so the
      // first synchronous read above still sees the previous file.
      editor.onDidChangeModel(() => {
        updateModelInfo();
        updateSymbols();
        updateCursor();
        updateSelection();
      }),
      editor.onDidChangeModelContent(scheduleSymbols),
      editor.onDidChangeModelLanguage(updateModelInfo),
      editor.onDidChangeModelOptions(updateModelInfo),
      editor.onDidChangeCursorPosition(updateCursor),
      editor.onDidChangeCursorSelection(updateSelection),
    ];

    return () => {
      if (symbolsTimer.current !== null) {
        window.clearTimeout(symbolsTimer.current);
        symbolsTimer.current = null;
      }
      for (const disposable of disposables) disposable.dispose();
    };
  }, [editor, focused, tabs]);

  // "Replace in Project" and other tools write files behind the editor's
  // back; reload the matching models so the next save keeps the new content.
  useEffect(() => {
    const handler = async (event: Event) => {
      const files = (event as CustomEvent<string[]>).detail;
      if (!Array.isArray(files)) return;

      for (const file of files) {
        try {
          const uri = monaco.Uri.file(file);
          const model = monaco.editor
            .getModels()
            .find((candidate) => candidate.uri.toString() === uri.toString());
          if (!model) continue;

          const text = await readTextFile(await nativePath(file));
          if (model.getValue() !== text) {
            model.setValue(text);
          }
        } catch (error) {
          console.error("Failed to reload changed file:", file, error);
        }
      }
    };

    window.addEventListener("crosscode:files-changed", handler);
    return () => window.removeEventListener("crosscode:files-changed", handler);
  }, []);

  useEffect(() => {
    if (!monacoEl.current || !editor) return;

    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });

    resizeObserver.observe(monacoEl.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [editor]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedIndex === null) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const mouseX = e.clientX;

    let insertIndex: number;
    if (mouseX < midpoint) {
      insertIndex = index;
    } else {
      insertIndex = index + 1;
    }

    if (insertIndex === draggedIndex || insertIndex === draggedIndex + 1) {
      setDropIndicatorIndex(null);
    } else {
      setDropIndicatorIndex(insertIndex);
    }
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedIndex === null) return;

    const container = e.currentTarget as HTMLElement;
    const mouseX = e.clientX;

    const lastTab = container.querySelector(".tab-wrapper:last-child");
    if (lastTab) {
      const lastTabRect = lastTab.getBoundingClientRect();
      if (mouseX > lastTabRect.right) {
        setDropIndicatorIndex(tabs.length);
        return;
      }
    }

    const firstTab = container.querySelector(".tab-wrapper:first-child");
    if (firstTab) {
      const firstTabRect = firstTab.getBoundingClientRect();
      if (mouseX < firstTabRect.left) {
        setDropIndicatorIndex(0);
        return;
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const container = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as Node;

    if (!container.contains(relatedTarget)) {
      setDropIndicatorIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (draggedIndex === null || dropIndicatorIndex === null) {
      setDraggedIndex(null);
      setDropIndicatorIndex(null);
      return;
    }

    const newTabs = [...tabs];
    const newOpenFiles = [...openFiles];

    let actualDropIndex = dropIndicatorIndex;
    if (draggedIndex < dropIndicatorIndex) {
      actualDropIndex = dropIndicatorIndex - 1;
    }

    const draggedTab = newTabs.splice(draggedIndex, 1)[0];
    const draggedFile = newOpenFiles.splice(draggedIndex, 1)[0];

    newTabs.splice(actualDropIndex, 0, draggedTab);
    newOpenFiles.splice(actualDropIndex, 0, draggedFile);

    let newFocused = focused;
    if (focused === draggedIndex) {
      newFocused = actualDropIndex;
    } else if (focused !== undefined) {
      if (draggedIndex < focused && actualDropIndex >= focused) {
        newFocused = focused - 1;
      } else if (draggedIndex > focused && actualDropIndex <= focused) {
        newFocused = focused + 1;
      }
    }

    setTabs(newTabs);
    setOpenFiles(newOpenFiles);
    setFocused(newFocused);
    setDraggedIndex(null);
    setDropIndicatorIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndicatorIndex(null);
  };

  useEffect(() => {
    let changeDisposable: { dispose: () => void } | null = null;
    let cancelled = false;

    let switchFile = async () => {
      if (!editor || focused === undefined || !tabs[focused]) return;
      let filePath = tabs[focused]?.file;
      if (!filePath) return;

      // Monaco only handles text; binaries get a preview (images) or are left
      // alone so the editor does not try to parse them.
      if (isImageFile(filePath)) {
        editor.setModel(null);
        setSaveFile(() => async () => {});
        return;
      }

      // Registration completes as soon as the services are ready; awaiting it
      // here makes sure the grammar exists before the model is created.
      await registerTomlLanguage();

      let file = monaco.Uri.file(filePath);
      let modelRef = await monaco.editor.createModelReference(file);
      if (cancelled) {
        modelRef.dispose();
        return;
      }
      modelRef.object.onDidChangeDirty(() => {
        setUnsavedFiles((files) => {
          if (modelRef.object.isDirty()) {
            return [...files, tabs[focused]?.file];
          } else {
            return files.filter((f) => f !== tabs[focused]?.file);
          }
        });
      });

      setSaveFile(() => async () => {
        if (formatOnSave) {
          await editor.getAction("editor.action.formatDocument")?.run();
        }
        await modelRef.object.save();
      });

      editor.setModel(modelRef.object.textEditorModel);

      const textModel = modelRef.object.textEditorModel;
      if (autosave && textModel) {
        changeDisposable = textModel.onDidChangeContent(() => {
          if (autosaveTimer.current !== null) {
            window.clearTimeout(autosaveTimer.current);
          }
          autosaveTimer.current = window.setTimeout(() => {
            autosaveTimer.current = null;
            if (!modelRef.object.isDirty()) return;
            modelRef.object.save().catch((error) => {
              console.error("Auto save failed:", error);
            });
          }, 800);
        });
      }

      if (scrollStates.current && scrollStates.current[filePath]) {
        const [scrollTop, scrollLeft] = scrollStates.current[filePath];
        editor.setScrollTop(scrollTop);
        editor.setScrollLeft(scrollLeft);
      }

      // I don't love doing it like this but it seems to improve consistency over just running it directly
      requestAnimationFrame(() => {
        if (
          selectionOverrideRef.current &&
          selectionOverrideRef.current.selection
        ) {
          editor.setSelection(
            {
              startLineNumber:
                selectionOverrideRef.current.selection.startLineNumber,
              startColumn: selectionOverrideRef.current.selection.startColumn,
              endLineNumber:
                selectionOverrideRef.current.selection.endLineNumber ??
                selectionOverrideRef.current.selection.startLineNumber,
              endColumn:
                selectionOverrideRef.current.selection.endColumn ??
                selectionOverrideRef.current.selection.startColumn,
            },
            selectionOverrideRef.current.selectionSource
          );
          editor.revealLineNearTop(
            selectionOverrideRef.current.selection.startLineNumber,
            0
          );
          selectionOverrideRef.current = null;
        }
      });
    };
    switchFile();

    return () => {
      cancelled = true;
      changeDisposable?.dispose();
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [focused, editor, tabs, formatOnSave, autosave]);

  // Jumping to a line is handled separately: the effect above must not restart
  // (it restores the previous scroll position) when a reveal request arrives.
  useEffect(() => {
    if (!reveal) return;
    let cancelled = false;
    let frame = 0;

    const tick = () => {
      if (cancelled) return;
      const index = tabs.findIndex((tab) => tab.file === reveal.file);
      const model = editor?.getModel() ?? null;
      if (editor && model && index !== -1 && focused === index) {
        const lineNumber = Math.min(
          Math.max(1, reveal.line),
          model.getLineCount()
        );
        editor.setPosition({ lineNumber, column: 1 });
        editor.revealLineInCenter(lineNumber);
        editor.focus();
        onRevealed?.();
        return;
      }
      // The editor switches models asynchronously; retry for about a second.
      if (frame++ < 60) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
    };
  }, [reveal, editor, focused, tabs, onRevealed]);

  return (
    <div
      className={"editor"}
      data-editor-theme={isLightTheme(resolvedTheme) ? "light" : "dark"}
    >
      <div
        className="tabsContainer MuiTabList-sizeSm"
        onDragOver={handleContainerDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
      >
        {tabs.map((tab, index) => {
          let unsaved = unsavedFiles.includes(tab.file);
          return (
            <div key={tab.file} className="tab-wrapper">
              {dropIndicatorIndex === index && (
                <div className="drop-indicator" />
              )}
              <TabLike
                className={
                  (focused === index ? " Mui-selected" : "") +
                  (draggedIndex === index ? " dragging" : "")
                }
                role="tab"
                draggable={true}
                onClick={() => {
                  setFocused(index);
                }}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <span className="tab-name" title={tab.file}>
                  {tab.name}
                </span>
                <IconButton
                  component="span"
                  onMouseEnter={() => setHoveredOnBtn(index)}
                  onMouseLeave={() => setHoveredOnBtn(null)}
                  size="xs"
                  sx={{ margin: "0px", marginLeft: "2px" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTabs((tabs) => tabs.filter((_, i) => i !== index));
                    setFocused((focused) => {
                      if (focused === index) return 0;
                      return focused;
                    });
                    setOpenFiles((openFiles) =>
                      openFiles.filter((file) => file !== tab.file)
                    );
                  }}
                >
                  {!unsaved || hoveredOnBtn === index ? (
                    <CloseIcon />
                  ) : (
                    <CircleIcon
                      sx={{ width: "10px", height: "10px", padding: "0 3px" }}
                    />
                  )}
                </IconButton>
              </TabLike>
            </div>
          );
        })}
        {dropIndicatorIndex === tabs.length && (
          <div className="drop-indicator drop-indicator-end" />
        )}
      </div>
      {breadcrumbs.length > 0 && (
        <div className="jump-bar">
          {breadcrumbs.map((part, index) => (
            <Fragment key={`${index}-${part}`}>
              {index > 0 && <span className="jump-separator">›</span>}
              <span
                className={
                  index === breadcrumbs.length - 1
                    ? "jump-item jump-item-active"
                    : "jump-item"
                }
                title={part}
              >
                {part}
              </span>
            </Fragment>
          ))}
          {!activeIsImage && (
            <>
              <span className="jump-separator">›</span>
              <button
                type="button"
                className="jump-item jump-item-current"
                title="Show symbols in this file"
                onClick={() => setSymbolsOpen(true)}
              >
                {currentSymbol?.name ?? "No symbols"}
                <span className="jump-chevron">⌄</span>
              </button>
            </>
          )}
        </div>
      )}
      <div
        className={"code-editor"}
        ref={monacoEl}
        style={tabs.length >= 1 && !activeIsImage ? {} : { display: "none" }}
      />
      {activeIsImage && (
        <div className="image-preview">
          {imageError ? (
            <div className="image-preview-message">
              <span>Could not open this image.</span>
              <code>{imageError}</code>
            </div>
          ) : imageUrl ? (
            <div className="image-preview-canvas">
              <img src={imageUrl} alt={activeTab?.name ?? ""} />
            </div>
          ) : (
            <div className="image-preview-message">Loading…</div>
          )}
        </div>
      )}
      {tabs.length > 0 && !activeIsImage && (
        <div className="editor-status-bar">
          <span className="status-item status-language">{modelInfo.language}</span>
          <span className="status-item">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          {selectionLength > 0 && (
            <span className="status-item">
              {selectionLength} selected
            </span>
          )}
          <span className="status-spacer" />
          <span className="status-item">
            {modelInfo.insertSpaces ? "Spaces" : "Tab Size"}:{" "}
            {modelInfo.tabSize}
          </span>
          <span className="status-item">UTF-8</span>
          <span className="status-item">{modelInfo.eol}</span>
        </div>
      )}
      <QuickPick
        open={symbolsOpen}
        title="Symbols in This File"
        placeholder="Filter symbols…"
        items={symbolItems}
        onClose={() => setSymbolsOpen(false)}
        emptyLabel="No symbols found in this file."
        footer={`${symbolItems.length} symbols`}
      />
    </div>
  );
};
