import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Input,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalDialog,
  Typography,
} from "@mui/joy";

export interface QuickPickItem {
  key: string;
  label: string;
  detail?: string;
  /** Small glyph or icon shown before the label. */
  glyph?: string;
  onSelect: () => void;
}

export interface QuickPickProps {
  open: boolean;
  title: string;
  placeholder?: string;
  items: QuickPickItem[];
  onClose: () => void;
  emptyLabel?: string;
  footer?: string;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

/** Substring match with a small bonus for matches at the start of a word. */
function score(item: QuickPickItem, query: string): number {
  if (!query) return 1;
  const label = normalize(item.label);
  const detail = normalize(item.detail ?? "");

  const index = label.indexOf(query);
  if (index !== -1) {
    return 1000 - index + (index === 0 ? 100 : 0);
  }
  if (detail.includes(query)) return 10;
  return 0;
}

export default function QuickPick({
  open,
  title,
  placeholder,
  items,
  onClose,
  emptyLabel = "No matches",
  footer,
}: QuickPickProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
  }, [open]);

  const rows = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return items;

    return items
      .map((item) => ({ item, rank: score(item, needle) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, rows]);

  const choose = (item: QuickPickItem | undefined) => {
    if (!item) return;
    onClose();
    // Let the modal close before the action runs so dialogs can take focus.
    requestAnimationFrame(() => item.onSelect());
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        aria-label={title}
        sx={{
          width: "min(640px, 92vw)",
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
          <Typography level="body-xs" textColor="text.tertiary" sx={{ mb: 0.5 }}>
            {title}
          </Typography>
          <Input
            autoFocus
            size="sm"
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, rows.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(rows[selected]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            sx={{ width: "100%" }}
          />
        </Box>

        <Box sx={{ maxHeight: "50vh", overflowY: "auto" }}>
          {rows.length === 0 && (
            <Typography
              level="body-sm"
              sx={{ padding: 2 }}
              textColor="text.tertiary"
            >
              {emptyLabel}
            </Typography>
          )}
          <List size="sm" sx={{ padding: 0 }}>
            {rows.map((item, index) => (
              <ListItem key={item.key} sx={{ padding: 0 }}>
                <ListItemButton
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(item)}
                  sx={{
                    paddingInline: "var(--padding-sm)",
                    paddingBlock: "4px",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--padding-sm)",
                  }}
                >
                  {item.glyph !== undefined && (
                    <Typography
                      level="body-xs"
                      textColor="text.tertiary"
                      sx={{ width: 12, flexShrink: 0, fontFamily: "monospace" }}
                    >
                      {item.glyph}
                    </Typography>
                  )}
                  <Typography
                    level="body-sm"
                    sx={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.label}
                  </Typography>
                  {item.detail && (
                    <Typography
                      level="body-xs"
                      textColor="text.tertiary"
                      sx={{
                        marginLeft: "auto",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontFamily: "monospace",
                      }}
                    >
                      {item.detail}
                    </Typography>
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
            gap: "var(--padding-md)",
            alignItems: "center",
          }}
        >
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
            {footer ?? `${rows.length} items`}
          </Typography>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
