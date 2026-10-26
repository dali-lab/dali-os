// The auth brand panel's animated tile cluster. DALI brand pairs (pale tile +
// strong motif, or strong tile + light motif) on an 8 × 4 grid; empty cells are
// intentional so sliding tiles have somewhere to go.

export type AuthTileMotif = "dot" | "ring" | "flower" | "quarter" | "solid" | "loose";
export type AuthTileLoop = "none" | "slide" | "flip" | "orbit" | "breathe" | "spin";

export type AuthTile = {
  id: string;
  col: number;
  row: number;
  bg: string;
  fg: string;
  motif: AuthTileMotif;
  loop: AuthTileLoop;
  /** slide: destination cell (must be empty) */
  toCol?: number;
  toRow?: number;
  /** flip: the colour pair revealed on the other side */
  altBg?: string;
  altFg?: string;
  /** Loop start offset, seconds — staggers the cluster so it never pulses in unison. */
  delay: number;
};

export const AUTH_TILE_GRID = { columns: 8, rows: 4 };

export const AUTH_TILES: AuthTile[] = [
  { id: "t1", col: 0, row: 0, bg: "transparent", fg: "#E45768", motif: "loose", loop: "breathe", delay: 0.4 },
  { id: "t2", col: 3, row: 0, bg: "#8CE0D6", fg: "#FFFFFF", motif: "dot", loop: "orbit", delay: 1.2 },
  { id: "t3", col: 6, row: 0, bg: "transparent", fg: "#FFCF88", motif: "loose", loop: "none", delay: 0 },

  { id: "t4", col: 0, row: 1, bg: "#24B1B1", fg: "#0B1C29", motif: "dot", loop: "slide", toCol: 1, toRow: 1, delay: 0.8 },
  { id: "t5", col: 2, row: 1, bg: "#FFF3B5", fg: "#E45768", motif: "flower", loop: "spin", delay: 0.2 },
  { id: "t6", col: 5, row: 1, bg: "#0C4876", fg: "#A2D483", motif: "dot", loop: "slide", toCol: 5, toRow: 0, delay: 3.2 },
  { id: "t7", col: 7, row: 1, bg: "#E68FBE", fg: "#0C4876", motif: "ring", loop: "none", delay: 0 },

  { id: "t8", col: 0, row: 2, bg: "#FFCF88", fg: "#E45768", motif: "quarter", loop: "none", delay: 0 },
  { id: "t9", col: 1, row: 2, bg: "#E68FBE", fg: "#0C4876", motif: "dot", loop: "flip", altBg: "#24B1B1", altFg: "#FFFFFF", delay: 1.6 },
  { id: "t10", col: 2, row: 2, bg: "#24B1B1", fg: "#24B1B1", motif: "solid", loop: "none", delay: 0 },
  { id: "t11", col: 3, row: 2, bg: "#FFF3B5", fg: "#E45768", motif: "dot", loop: "breathe", delay: 0.6 },
  { id: "t12", col: 5, row: 2, bg: "#8CE0D6", fg: "#0C4876", motif: "dot", loop: "slide", toCol: 4, toRow: 2, delay: 5.4 },
  { id: "t13", col: 6, row: 2, bg: "#0C4876", fg: "#FFF3B5", motif: "flower", loop: "spin", delay: 1.8 },

  { id: "t14", col: 0, row: 3, bg: "#24B1B1", fg: "#FFFFFF", motif: "ring", loop: "none", delay: 0 },
  { id: "t15", col: 1, row: 3, bg: "#0C4876", fg: "#A2D483", motif: "dot", loop: "none", delay: 0 },
  { id: "t16", col: 2, row: 3, bg: "#E68FBE", fg: "#0C4876", motif: "quarter", loop: "none", delay: 0 },
  { id: "t17", col: 3, row: 3, bg: "#24B1B1", fg: "#0B1C29", motif: "dot", loop: "flip", altBg: "#FFCF88", altFg: "#E45768", delay: 3.4 },
  { id: "t18", col: 4, row: 3, bg: "#FFF3B5", fg: "#FFF3B5", motif: "solid", loop: "none", delay: 0 },
  { id: "t19", col: 5, row: 3, bg: "#E68FBE", fg: "#FFF3B5", motif: "dot", loop: "orbit", delay: 0.3 },
  { id: "t20", col: 6, row: 3, bg: "#FFCF88", fg: "#0C4876", motif: "ring", loop: "breathe", delay: 2.2 },
  { id: "t21", col: 7, row: 3, bg: "#8CE0D6", fg: "#0C4876", motif: "dot", loop: "flip", altBg: "#E68FBE", altFg: "#0C4876", delay: 4.6 },
];
