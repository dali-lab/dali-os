// Member-facing docs for connecting Claude to DALI OS via MCP.

import type { Route } from "./+types/help.mcp";

export async function loader() {
  const base = process.env.API_BASE_URL ?? "https://os.dali.dartmouth.edu";
  return { mcpUrl: `${base}/mcp` };
}

export default function McpHelpPage({ loaderData }: Route.ComponentProps) {
  const { mcpUrl } = loaderData;
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Connect Claude to DALI OS</h1>
      <p className="mt-2 text-sm text-zinc-600">
        DALI OS exposes an MCP server so AI assistants like Claude can read your
        DALI data on your behalf. v1 ships a single tool —{" "}
        <code className="font-mono">whoami</code> — to validate the auth flow.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Claude Code</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
          claude mcp add --transport http dalios {mcpUrl}
        </pre>
        <p className="mt-2 text-sm text-zinc-600">
          Claude Code will open a browser to authorize you and then keep the
          bearer in its credential store.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Codex</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
          codex mcp add dalios {mcpUrl}
        </pre>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Claude Desktop</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Add this entry to your Claude Desktop config (<code>claude_desktop_config.json</code>)
          and restart the app:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
{`{
  "mcpServers": {
    "dalios": {
      "transport": { "type": "http", "url": "${mcpUrl}" }
    }
  }
}`}
        </pre>
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
