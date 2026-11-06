import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { Box, CircularProgress, Typography } from "@mui/joy";
import { invoke } from "@tauri-apps/api/core";
import { languageForPath } from "../utilities/language";

export interface DiffViewerProps {
  projectPath: string;
  file: string;
  staged: boolean;
  untracked: boolean;
  dark: boolean;
}

type Versions = { original: string | null; modified: string | null };

/**
 * Side-by-side read-only diff rendered with Monaco. Falls back to a plain text
 * message when neither revision of the file could be read.
 */
export default ({
  projectPath,
  file,
  staged,
  untracked,
  dark,
}: DiffViewerProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [versions, setVersions] = useState<Versions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setError(null);

    invoke<Versions>("git_file_versions", {
      projectPath,
      file,
      staged,
      untracked,
    })
      .then((result) => {
        if (!cancelled) setVersions(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(String(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, file, staged, untracked]);

  useEffect(() => {
    const container = containerRef.current;
    if (!versions || !container) return;

    const language = languageForPath(file);
    const originalModel = monaco.editor.createModel(
      versions.original ?? "",
      language
    );
    const modifiedModel = monaco.editor.createModel(
      versions.modified ?? "",
      language
    );

    const editor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      automaticLayout: true,
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
      theme: dark ? "vs-dark" : "vs",
    });

    editor.setModel({ original: originalModel, modified: modifiedModel });

    return () => {
      // The models are owned by this component, not by the shared editor.
      editor.setModel(null);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [versions, dark, file]);

  if (error) {
    return (
      <Typography level="body-sm" color="danger">
        {error}
      </Typography>
    );
  }

  if (!versions) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", padding: 2 }}>
        <CircularProgress size="sm" />
      </Box>
    );
  }

  const empty = !versions.original && !versions.modified;
  if (empty) {
    return (
      <Typography level="body-sm" textColor="text.tertiary">
        This file has no content in the compared revision.
      </Typography>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{ width: "100%", height: "60vh", minHeight: 240, borderRadius: "sm" }}
    />
  );
};
