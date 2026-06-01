// Member-facing docs for connecting an AI assistant to DALI OS via MCP.

import { useState } from "react";
import { Check, Copy } from "lucide-react";
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
      <h1 className="text-2xl font-semibold">Connect AI to DALI OS</h1>
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
        <h2 className="text-lg font-semibold">What can an assistant do?</h2>
        <p className="mt-2 text-sm text-zinc-600">
          DALI OS currently exposes these tools over MCP. Read tools need only{" "}
          <code className="font-mono">mcp:read</code>; write tools need{" "}
          <code className="font-mono">mcp:write</code>.
        </p>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-zinc-700 list-disc pl-5">
          <li><code className="font-mono">whoami</code> — identity + role tier</li>
          <li><code className="font-mono">search_directory</code> — find a member</li>
          <li><code className="font-mono">get_member_profile</code> — single member</li>
          <li><code className="font-mono">list_groups</code> — your lab groups</li>
          <li><code className="font-mono">list_my_notifications</code> — inbox</li>
          <li><code className="font-mono">mark_notification_read</code> — clear one</li>
          <li><code className="font-mono">rsvp_to_notification</code> — accept/decline an invite</li>
          <li><code className="font-mono">list_my_upcoming_meetings</code> — next N days</li>
          <li><code className="font-mono">list_my_calendar_links</code> — Google calendars</li>
          <li><code className="font-mono">find_mutual_freebusy</code> — group availability</li>
          <li><code className="font-mono">schedule_meeting</code> — create one</li>
          <li><code className="font-mono">cancel_meeting</code> — cancel one you organize</li>
          <li><code className="font-mono">list_my_projects</code> — projects you're on</li>
          <li><code className="font-mono">get_project_overview</code> — project detail</li>
          <li><code className="font-mono">list_my_tasks</code> — your project tasks</li>
          <li><code className="font-mono">update_task_status</code> — move a task</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Resources (auto-attachable context)</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Clients can attach these as <em>resources</em>, separate from tool calls.
          Some clients (Claude Desktop) let you pin them so they ride along on every message.
        </p>
        <ul className="mt-3 text-sm text-zinc-700 list-disc pl-5">
          <li><code className="font-mono">dali://me</code> — your profile, roles, domain eligibilities</li>
          <li><code className="font-mono">dali://announcements/active</code> — your unread lab announcements (markdown)</li>
          <li><code className="font-mono">dali://forms/pending</code> — published forms you've been asked to fill</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Prompts (templated workflows)</h2>
        <p className="mt-2 text-sm text-zinc-600">
          These appear as commands in the client (e.g. <code className="font-mono">/dali:weekly-digest</code> in
          Claude Code). The model carries them out by calling the MCP tools above.
        </p>
        <ul className="mt-3 text-sm text-zinc-700 list-disc pl-5">
          <li><code className="font-mono">weekly-digest</code> — focus, meetings, inbox, suggested next action</li>
          <li><code className="font-mono">meeting-prep</code> — agenda + talking points for an upcoming meeting</li>
          <li><code className="font-mono">project-status</code> — status report draft for a project you're on</li>
        </ul>
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
