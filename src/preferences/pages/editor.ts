import { createItems, createPreferencePage } from "../helpers";

// Every stack ends with a generic `monospace` so that a missing font can never
// leave the editor without one. The DejaVu/Liberation entries are what Linux
// distributions actually ship: SF Mono, Menlo and Consolas do not exist there.
const LEGACY_DEFAULT_FONT =
  "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

export const DEFAULT_EDITOR_FONT =
  "'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'Courier New', monospace";

/** Upgrades the pre-0.1.5 default to the stack that also covers Linux. */
export function normalizeEditorFont(value: string): string {
  return value === LEGACY_DEFAULT_FONT ? DEFAULT_EDITOR_FONT : value;
}

const fonts = [
  {
    label: "SF Mono (falls back per platform)",
    value: DEFAULT_EDITOR_FONT,
  },
  { label: "Menlo", value: "Menlo, 'DejaVu Sans Mono', monospace" },
  {
    label: "Consolas",
    value: "Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
  {
    label: "Cascadia Code",
    value: "'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace",
  },
  {
    label: "JetBrains Mono",
    value: "'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace",
  },
  {
    label: "System monospace",
    value: "ui-monospace, 'DejaVu Sans Mono', 'Liberation Mono', monospace",
  },
];

export const editorPage = createPreferencePage(
  "editor",
  "Code Editor",
  [
    createItems.select(
      "theme",
      "Editor Theme",
      [
        { label: "Match application", value: "auto" },
        { label: "Xcode Light", value: "light" },
        { label: "Xcode Dark", value: "dark" },
      ],
      "Colors used by the code editor. 'Match application' follows the app theme.",
      "auto"
    ),
    createItems.number(
      "font-size",
      "Font Size",
      "Editor font size in points, 9 to 24.",
      13
    ),
    createItems.select(
      "font-family",
      "Font",
      fonts,
      "Font used for code. Xcode uses SF Mono.",
      fonts[0].value
    ),
    createItems.checkbox(
      "ligatures",
      "Font Ligatures",
      "Render ligatures when the selected font supports them.",
      false
    ),
  ],
  {
    description: "Customize the code editor",
    category: "general",
  }
);
