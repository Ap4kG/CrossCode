import * as monaco from "monaco-editor";
import { registerExtension } from "@codingame/monaco-vscode-api/extensions";

/**
 * Xcode's default editor themes, registered as a VS Code theme extension.
 *
 * monaco-vscode-api does not expose `monaco.editor.defineTheme` (the service it
 * routes to is the workbench theme service, which has no such method), so the
 * supported way to add themes is to contribute them through an extension.
 */
export const XCODE_LIGHT_THEME = "Xcode Light";
export const XCODE_DARK_THEME = "Xcode Dark";

const lightColors: Record<string, string> = {
  "editor.background": "#FFFFFF",
  "editor.foreground": "#000000",
  "editorLineNumber.foreground": "#9AA0A6",
  "editorLineNumber.activeForeground": "#3C3C43",
  "editorCursor.foreground": "#000000",
  "editor.selectionBackground": "#B3D7FF",
  "editor.inactiveSelectionBackground": "#D6E9FF99",
  "editor.selectionHighlightBackground": "#B3D7FF80",
  "editor.wordHighlightBackground": "#B3D7FF4D",
  "editor.wordHighlightStrongBackground": "#B3D7FF80",
  "editor.findMatchBackground": "#FFE28A",
  "editor.findMatchHighlightBackground": "#FFE28A66",
  "editor.lineHighlightBackground": "#00000000",
  "editor.lineHighlightBorder": "#00000000",
  "editorIndentGuide.background1": "#00000014",
  "editorIndentGuide.activeBackground1": "#00000033",
  "editorBracketMatch.background": "#B3D7FF80",
  "editorBracketMatch.border": "#B3D7FF",
  "editorGutter.background": "#FFFFFF",
  "editorGutter.modifiedBackground": "#0F68A0",
  "editorGutter.addedBackground": "#2E8B57",
  "editorGutter.deletedBackground": "#C41A16",
  "editorWidget.background": "#F5F5F7",
  "editorWidget.foreground": "#000000",
  "editorWidget.border": "#D8D8DC",
  "editorSuggestWidget.background": "#FFFFFF",
  "editorSuggestWidget.border": "#D8D8DC",
  "editorSuggestWidget.selectedBackground": "#E6E6E8",
  "editorSuggestWidget.highlightForeground": "#0F68A0",
  "editorHoverWidget.background": "#FFFFFF",
  "editorHoverWidget.border": "#D8D8DC",
  "editorOverviewRuler.border": "#00000000",
  "scrollbarSlider.background": "#0000001F",
  "scrollbarSlider.hoverBackground": "#0000003A",
  "scrollbarSlider.activeBackground": "#0000005A",
  "editorError.foreground": "#C41A16",
  "editorWarning.foreground": "#C08A1B",
  "editorInfo.foreground": "#0F68A0",
};

const darkColors: Record<string, string> = {
  "editor.background": "#1F1F24",
  "editor.foreground": "#FFFFFF",
  "editorLineNumber.foreground": "#7F8C98",
  "editorLineNumber.activeForeground": "#FFFFFF",
  "editorCursor.foreground": "#FFFFFF",
  "editor.selectionBackground": "#3F638B",
  "editor.inactiveSelectionBackground": "#3F638B80",
  "editor.selectionHighlightBackground": "#3F638B80",
  "editor.wordHighlightBackground": "#FFFFFF1A",
  "editor.wordHighlightStrongBackground": "#FFFFFF33",
  "editor.findMatchBackground": "#FFD54F66",
  "editor.findMatchHighlightBackground": "#FFD54F38",
  "editor.lineHighlightBackground": "#FFFFFF0A",
  "editor.lineHighlightBorder": "#00000000",
  "editorIndentGuide.background1": "#FFFFFF14",
  "editorIndentGuide.activeBackground1": "#FFFFFF33",
  "editorBracketMatch.background": "#3F638B80",
  "editorBracketMatch.border": "#5DD8FF",
  "editorGutter.background": "#1F1F24",
  "editorGutter.modifiedBackground": "#5DD8FF",
  "editorGutter.addedBackground": "#67B7A4",
  "editorGutter.deletedBackground": "#FC6A5D",
  "editorWidget.background": "#252529",
  "editorWidget.foreground": "#FFFFFF",
  "editorWidget.border": "#3A3A3E",
  "editorSuggestWidget.background": "#252529",
  "editorSuggestWidget.border": "#3A3A3E",
  "editorSuggestWidget.selectedBackground": "#3A3A41",
  "editorSuggestWidget.highlightForeground": "#5DD8FF",
  "editorHoverWidget.background": "#252529",
  "editorHoverWidget.border": "#3A3A3E",
  "editorOverviewRuler.border": "#00000000",
  "scrollbarSlider.background": "#FFFFFF1F",
  "scrollbarSlider.hoverBackground": "#FFFFFF3A",
  "scrollbarSlider.activeBackground": "#FFFFFF5A",
  "editorError.foreground": "#FC6A5D",
  "editorWarning.foreground": "#D0BF69",
  "editorInfo.foreground": "#5DD8FF",
};

function tokenColors(light: boolean) {
  const c = light
    ? {
        plain: "#000000",
        comment: "#5D6C79",
        string: "#C41A16",
        number: "#1C00CF",
        keyword: "#AD3DA4",
        type: "#0B4F79",
        declaration: "#326D74",
        constant: "#643820",
        escape: "#0F68A0",
      }
    : {
        plain: "#FFFFFF",
        comment: "#7F8C98",
        string: "#FC6A5D",
        number: "#D0BF69",
        keyword: "#FC5FA3",
        type: "#5DD8FF",
        declaration: "#67B7A4",
        constant: "#D0BF69",
        escape: "#5DD8FF",
      };

  return [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.comment } },
    { scope: ["string", "punctuation.definition.string"], settings: { foreground: c.string } },
    { scope: ["string.regexp"], settings: { foreground: c.string } },
    { scope: ["constant.numeric"], settings: { foreground: c.number } },
    { scope: ["constant.language"], settings: { foreground: c.keyword } },
    { scope: ["constant.character.escape"], settings: { foreground: c.escape } },
    { scope: ["constant", "support.constant"], settings: { foreground: c.number } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier"], settings: { foreground: c.keyword } },
    { scope: ["keyword.operator"], settings: { foreground: c.plain } },
    { scope: ["entity.name.type", "entity.name.class", "entity.name.struct", "entity.name.enum"], settings: { foreground: c.declaration } },
    { scope: ["entity.name.function"], settings: { foreground: c.declaration } },
    { scope: ["entity.name.tag"], settings: { foreground: c.keyword } },
    { scope: ["punctuation.definition.tag"], settings: { foreground: c.comment } },
    { scope: ["entity.name.type.toml", "entity.name.section", "support.type.property-name"], settings: { foreground: c.declaration } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: c.constant } },
    { scope: ["support.type", "support.class"], settings: { foreground: c.type } },
    { scope: ["support.function"], settings: { foreground: c.type } },
    { scope: ["variable.other.property"], settings: { foreground: c.declaration } },
    { scope: ["variable", "variable.parameter", "meta.definition.variable"], settings: { foreground: c.plain } },
    { scope: ["meta.preprocessor"], settings: { foreground: c.constant } },
    { scope: ["constant.other.color", "constant.other.color.rgb-value"], settings: { foreground: c.constant } },
    { scope: ["markup.underline.link", "string.other.link"], settings: { foreground: c.type } },
    { scope: ["markup.inline.raw"], settings: { foreground: c.string } },
    { scope: ["invalid"], settings: { foreground: "#FFFFFF", background: "#FF0000" } },
    { scope: ["markup.heading"], settings: { foreground: c.keyword, fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  ];
}

const lightTheme = {
  name: XCODE_LIGHT_THEME,
  type: "light",
  colors: lightColors,
  tokenColors: tokenColors(true),
};

const darkTheme = {
  name: XCODE_DARK_THEME,
  type: "dark",
  colors: darkColors,
  tokenColors: tokenColors(false),
};

let registration: Promise<void> | null = null;

function blobUrl(theme: unknown): string {
  return URL.createObjectURL(
    new Blob([JSON.stringify(theme)], { type: "application/json" })
  );
}

/**
 * Registers both Xcode themes. Resolves once the themes are available to the
 * theme service, so `setEditorTheme` can be called right after it.
 */
export function ensureXcodeThemes(): Promise<void> {
  if (registration) return registration;

  registration = (async () => {
    const extension = registerExtension(
      {
        name: "crosscode-themes",
        publisher: "crosscode",
        version: "1.0.0",
        engines: { vscode: "*" },
        contributes: {
          themes: [
            {
              id: XCODE_LIGHT_THEME,
              label: XCODE_LIGHT_THEME,
              uiTheme: "vs",
              path: "./themes/xcode-light.json",
            },
            {
              id: XCODE_DARK_THEME,
              label: XCODE_DARK_THEME,
              uiTheme: "vs-dark",
              path: "./themes/xcode-dark.json",
            },
          ],
        },
      },
      undefined,
      { system: true }
    ) as unknown as {
      registerFileUrl: (
        path: string,
        url: string,
        metadata?: { mimeType?: string }
      ) => unknown;
      whenReady: () => Promise<void>;
    };

    extension.registerFileUrl("./themes/xcode-light.json", blobUrl(lightTheme), {
      mimeType: "application/json",
    });
    extension.registerFileUrl("./themes/xcode-dark.json", blobUrl(darkTheme), {
      mimeType: "application/json",
    });

    await extension.whenReady();
  })().catch((error) => {
    // Fall back to the built-in themes rather than breaking the editor.
    console.error("Failed to register the Xcode themes:", error);
    registration = null;
  });

  return registration;
}

/** Applies a theme by label, falling back to the built-in one. */
export async function setEditorTheme(themeLabel: string, light: boolean) {
  await ensureXcodeThemes();
  try {
    monaco.editor.setTheme(themeLabel);
  } catch (error) {
    console.error("Failed to apply editor theme:", error);
    monaco.editor.setTheme(light ? "vs" : "vs-dark");
  }
}

/** Resolves the preference value ("auto" | "light" | "dark") to a theme id. */
export function resolveEditorTheme(
  preference: string,
  appMode: string | undefined
): string {
  const effective =
    preference === "auto"
      ? appMode === "light"
        ? "light"
        : "dark"
      : preference;
  return effective === "light" ? XCODE_LIGHT_THEME : XCODE_DARK_THEME;
}

export function isLightTheme(themeId: string): boolean {
  return themeId === XCODE_LIGHT_THEME;
}
