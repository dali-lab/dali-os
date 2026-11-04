import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import type { CitedSource } from "../sources";

const CITE_PREFIX = "#ask-cite-";

export function linkCitations(answer: string): string {
  return answer.replace(/\[(\d+)\](?!\()/g, (_m, n: string) => `[${n}](${CITE_PREFIX}${n})`);
}

export function AskAnswer({ text, sources }: { text: string; sources: CitedSource[] }) {
  const byNumber = new Map(sources.map((s) => [String(s.n), s]));
  return (
    <div className="text-[15px] leading-[25px] text-foreground [word-break:break-word]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          p: (props) => <p className="my-3 first:mt-0 last:mb-0" {...props} />,
          ul: (props) => <ul className="my-3 flex list-disc flex-col gap-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-3 flex list-decimal flex-col gap-1 pl-5" {...props} />,
          strong: (props) => <strong className="font-bold" {...props} />,
          code: (props) => <code className="rounded bg-os-well px-1 py-0.5 font-mono text-[0.85em]" {...props} />,
          a: ({ href, children }) => {
            const source = href?.startsWith(CITE_PREFIX) ? byNumber.get(href.slice(CITE_PREFIX.length)) : undefined;
            if (!source) return <>{children}</>;
            return (
              <Link
                to={source.url}
                title={source.title}
                className="ml-0.5 align-baseline text-[11px] font-extrabold text-os-accent hover:underline"
              >
                [{source.n}]
              </Link>
            );
          },
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}
