export type OfferingSurface = {
  kind: "member" | "portal";
  base: "/education" | "/portal/education";
  otherBase: "/education" | "/portal/education";
  titleSuffix: "DALI OS" | "DALI";
};

export const MEMBER_SURFACE: OfferingSurface = {
  kind: "member",
  base: "/education",
  otherBase: "/portal/education",
  titleSuffix: "DALI OS",
};

export const PORTAL_SURFACE: OfferingSurface = {
  kind: "portal",
  base: "/portal/education",
  otherBase: "/education",
  titleSuffix: "DALI",
};

export function surfaceTitle(surface: OfferingSurface, title: string): string {
  return `${title} · ${surface.titleSuffix}`;
}

export function sendsAway(surface: OfferingSurface, userType: string | undefined): boolean {
  return surface.kind === "member" ? userType === "dartmouth" : userType === "member";
}
