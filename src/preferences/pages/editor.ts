import { createItems, createPreferencePage } from "../helpers";

const fonts = [
  {
    label: "SF Mono (falls back to Menlo / Consolas)",
    value: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
  },
  { label: "Menlo", value: "Menlo, monospace" },
  { label: "Consolas", value: "Consolas, 'Courier New', monospace" },
  { label: "Cascadia Code", value: "'Cascadia Code', Consolas, monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', Consolas, monospace" },
  { label: "System monospace", value: "ui-monospace, monospace" },
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
