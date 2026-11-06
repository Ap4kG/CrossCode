import { Component, ErrorInfo, ReactNode } from "react";
import { Box, Button, Sheet, Typography } from "@mui/joy";
import { invoke } from "@tauri-apps/api/core";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

/**
 * Catches render-time errors so a bug in one screen does not leave the whole
 * window blank. Async errors are still handled locally by their components.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info);
    this.setState({ info });
  }

  private details(): string {
    const { error, info } = this.state;
    if (!error) return "";
    return [
      `Error: ${error.message}`,
      error.stack ?? "",
      info?.componentStack ? `Component stack:${info.componentStack}` : "",
      `User agent: ${navigator.userAgent}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
    } catch (copyError) {
      console.error("Failed to copy error details:", copyError);
    }
  };

  render() {
    const { error, info, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <Sheet
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--padding-md)",
          padding: "var(--padding-lg)",
          overflow: "auto",
        }}
      >
        <Typography level="h2">Something went wrong</Typography>
        <Typography level="body-md">
          CrossCode hit an unexpected error while rendering this screen. Your
          files are safe. You can reload the window below; if the problem keeps
          happening, please report it with the details shown here.
        </Typography>
        <Box sx={{ display: "flex", gap: "var(--padding-sm)" }}>
          <Button onClick={() => window.location.reload()}>Reload window</Button>
          <Button
            variant="outlined"
            onClick={() => {
              invoke("open_devtools").catch(console.error);
            }}
          >
            Open devtools
          </Button>
          <Button variant="outlined" onClick={this.copyDetails}>
            {copied ? "Copied!" : "Copy details"}
          </Button>
        </Box>
        <Box
          component="pre"
          sx={{
            margin: 0,
            padding: "var(--padding-sm)",
            bgcolor: "background.level1",
            borderRadius: "var(--joy-radius-sm)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            overflow: "auto",
            maxHeight: "40vh",
          }}
        >
          {error.stack ?? error.message}
          {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ""}
        </Box>
      </Sheet>
    );
  }
}
