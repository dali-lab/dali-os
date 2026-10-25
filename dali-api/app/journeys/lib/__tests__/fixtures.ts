import type { Journey, JourneyModule } from "../types";

export function mod(id: string, dependsOn: string[] = [], extra: Partial<JourneyModule> = {}): JourneyModule {
  return {
    id,
    title: `Module ${id}`,
    summary: "",
    duration: "20 min",
    dependsOn,
    position: { x: 0, y: 0 },
    pages: [{ id: `${id}-p1`, title: "Page", content: [] }],
    ...extra,
  };
}

/** a → b, a → c, (b, c) → d */
export function diamond(): Journey {
  return {
    id: "j1",
    title: "Journey",
    description: "",
    modules: [mod("a"), mod("b", ["a"]), mod("c", ["a"]), mod("d", ["b", "c"])],
  };
}
