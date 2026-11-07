import { Typography } from "@mui/joy";
import "./Tile.css";

export interface TileProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** When false the tile content is flush with the tile edges. */
  padded?: boolean;
}

export default ({ title, children, className, padded = true }: TileProps) => {
  return (
    <div className={padded ? "tile" : "tile tile-unpadded"}>
      {title != null && (
        <Typography level="body-xs" className={"tile-title"}>
          {title}
        </Typography>
      )}
      <div className={"tile-content" + (className ? " " + className : "")}>
        {children}
      </div>
    </div>
  );
};
