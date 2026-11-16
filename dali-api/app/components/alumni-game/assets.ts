import { HAIRSTYLES, type AvatarAssets } from "./pixel-avatar";

// Every lab + avatar sheet, keyed by file name. Vite rewrites these to
// hashed URLs at build time.
export const ART: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../assets/alumni-lab/**/*.{png,gif}", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.split("/").pop()!, url]),
);

export const AVATAR_ASSETS: AvatarAssets = {
  base: ART["base.png"],
  hair: Object.fromEntries(HAIRSTYLES.map((h) => [h.asset, ART[`${h.asset}.png`]])),
};
