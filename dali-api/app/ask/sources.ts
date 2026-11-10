export type AskSourceKind =
  | "document"
  | "meeting"
  | "transcript"
  | "task"
  | "project"
  | "person"
  | "group"
  | "education"
  | "form"
  | "guide"
  | "helpArticle"
  | "page";

export type AskSourceInput = {
  kind: AskSourceKind;
  title: string;
  url: string;
  date?: string | null;
  detail?: string | null;
};

export type AskSource = AskSourceInput & { ref: string };

export type CitedSource = AskSource & { n: number };

export class SourceRegistry {
  private byRef = new Map<string, AskSource>();
  private byUrl = new Map<string, AskSource>();

  add(input: AskSourceInput): AskSource {
    const existing = this.byUrl.get(input.url);
    if (existing) return existing;
    const source: AskSource = { ...input, title: input.title.trim() || "Untitled", ref: `s${this.byRef.size + 1}` };
    this.byRef.set(source.ref, source);
    this.byUrl.set(source.url, source);
    return source;
  }

  get(ref: string): AskSource | undefined {
    return this.byRef.get(ref);
  }

  get size(): number {
    return this.byRef.size;
  }
}

const CITATION = /\[(s\d+(?:\s*,\s*s\d+)*)\]/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g;

export function finalizeAnswer(
  text: string,
  registry: SourceRegistry,
): { answer: string; sources: CitedSource[] } {
  const cited: CitedSource[] = [];
  const numberFor = new Map<string, number>();
  const stripped = text.replace(IMAGE, "").replace(LINK, "$1").replace(AUTOLINK, "$1");
  const answer = stripped
    .replace(CITATION, (_m, refs: string) => {
      const markers: string[] = [];
      for (const ref of refs.split(",").map((r) => r.trim())) {
        const source = registry.get(ref);
        if (!source) continue;
        let n = numberFor.get(ref);
        if (n === undefined) {
          n = cited.length + 1;
          numberFor.set(ref, n);
          cited.push({ ...source, n });
        }
        if (!markers.includes(`[${n}]`)) markers.push(`[${n}]`);
      }
      return markers.join("");
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
  return { answer, sources: cited };
}
