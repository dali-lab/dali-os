import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Lightweight markdown renderer for short app content (e.g. a project
// description). react-markdown is safe by default — it does NOT render raw
// HTML embedded in the source, so user input can't inject markup. GFM adds
// tables, strikethrough, task lists, and autolinks.
//
// No Tailwind typography plugin in this project, so element styles are mapped
// explicitly to the app's design tokens. Links open in a new tab.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-foreground leading-relaxed [word-break:break-word]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h1 className="font-heading text-lg font-bold text-foreground mt-3 mb-1.5 first:mt-0" {...props} />
          ),
          h2: (props) => (
            <h2 className="font-heading text-base font-bold text-foreground mt-3 mb-1.5 first:mt-0" {...props} />
          ),
          h3: (props) => (
            <h3 className="font-heading text-sm font-semibold text-foreground mt-2.5 mb-1 first:mt-0" {...props} />
          ),
          p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...props} />,
          a: (props) => (
            <a
              target="_blank"
              rel="noreferrer"
              className="text-accent-coral hover:underline break-all"
              {...props}
            />
          ),
          ul: (props) => <ul className="list-disc pl-5 my-1.5 flex flex-col gap-0.5" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 my-1.5 flex flex-col gap-0.5" {...props} />,
          li: (props) => <li className="marker:text-muted-foreground" {...props} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-border pl-3 my-1.5 text-muted-foreground" {...props} />
          ),
          code: (props) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props} />
          ),
          pre: (props) => (
            <pre className="rounded-md bg-muted p-3 my-2 overflow-x-auto text-xs font-mono" {...props} />
          ),
          hr: (props) => <hr className="my-3 border-border" {...props} />,
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-left border-collapse" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-border px-2 py-1 font-semibold bg-muted/50" {...props} />
          ),
          td: (props) => <td className="border border-border px-2 py-1" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
