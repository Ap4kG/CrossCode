import { useContext, useState } from "react";
import { Button, Chip, Typography } from "@mui/joy";
import { UpdateContext } from "../utilities/UpdateContext";

/**
 * Xcode-style update strip. Appears when the background check finds a newer
 * release; installing uses the same signed updater flow as the menu command.
 */
export default function UpdateBanner() {
  const { availableVersion, installAvailable, dismissUpdate } =
    useContext(UpdateContext);
  const [installing, setInstalling] = useState(false);

  if (!availableVersion) return null;

  return (
    <output className="update-banner">
      <Chip size="sm" variant="soft" color="success" sx={{ fontSize: 11 }}>
        Update
      </Chip>
      <Typography level="body-sm">
        CrossCode {availableVersion} is available.
      </Typography>
      <div className="update-banner-actions">
        <Button
          size="sm"
          variant="solid"
          loading={installing}
          onClick={async () => {
            setInstalling(true);
            try {
              await installAvailable();
            } finally {
              setInstalling(false);
            }
          }}
        >
          Install
        </Button>
        <Button size="sm" variant="plain" onClick={dismissUpdate}>
          Later
        </Button>
      </div>
    </output>
  );
}
