// Member-facing docs for connecting an AI assistant to DALI OS via MCP.

import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Check, Copy } from "lucide-react";
import type { Route } from "./+types/help.mcp";

export async function loader() {
  const base = process.env.API_BASE_URL ?? "https://os.dali.dartmouth.edu";
  return { mcpUrl: `${base}/mcp` };
}

function CopyBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — give up silently
    }
  }
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded bg-zinc-900 p-3 pr-10 text-xs text-zinc-100 whitespace-pre">
        {content}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute top-2 right-2 p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/10"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function McpHelpPage({ loaderData }: Route.ComponentProps) {
  const { mcpUrl } = loaderData;
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link
        to="/help"
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Help
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Connect AI to DALI OS</h1>
      <p className="mt-2 text-sm text-zinc-600">
        DALI OS exposes an MCP server so AI assistants can read your DALI data
        on your behalf.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Claude Code</h2>
        <CopyBlock content={`claude mcp add --transport http dalios ${mcpUrl}`} />
        <p className="mt-2 text-sm text-zinc-600">
          Claude Code will open a browser to authorize you and then keep the
          bearer in its credential store.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Codex</h2>
        <CopyBlock content={`codex mcp add dalios ${mcpUrl}`} />
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Claude Desktop</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Add this entry to your Claude Desktop config (<code>claude_desktop_config.json</code>)
          and restart the app:
        </p>
        <CopyBlock
          content={`{
  "mcpServers": {
    "dalios": {
      "transport": { "type": "http", "url": "${mcpUrl}" }
    }
  }
}`}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Other clients</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Any MCP-compatible client that speaks Streamable HTTP can use{" "}
          <code className="font-mono">{mcpUrl}</code> as the endpoint. The
          OAuth metadata document is at{" "}
          <code className="font-mono">/.well-known/oauth-authorization-server</code>.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Managing connections</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Visit{" "}
          <a className="text-blue-700 underline" href="/settings/connected-apps">
            Settings → Connected apps
          </a>{" "}
          to review or revoke an authorization at any time.
        </p>
      </section>
    </main>
  );
}
