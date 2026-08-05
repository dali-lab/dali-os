// Member-facing docs for connecting an AI assistant to DALI OS via MCP.

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Route } from "./+types/help.mcp";
import { getApiBaseUrl } from "~/lib/app-env";

// This page intentionally describes the MCP surface by CATEGORY rather than
// enumerating every tool: the catalog is large (~140 tools) and changes often,
// and importing the live tool defs here would pull the server tool graph
// (prisma, collab auth, notifications) into the client bundle. The client's own
// tools/list is the always-current, authoritative catalog.
export async function loader() {
  const base = getApiBaseUrl();
  return { mcpUrl: `${base}/mcp` };
}

// Category → what an assistant can do there. Scope column is the *minimum* the
// client must be granted; every call is additionally filtered by your real role.
const TOOL_CATEGORIES: { area: string; scope: string; blurb: string }[] = [
  { area: "You & directory", scope: "read", blurb: "whoami, your roles, member search + profiles, groups, terms, domains" },
  { area: "Notifications", scope: "read / write", blurb: "list + read your inbox, RSVP, manage notification preferences" },
  { area: "Calendar", scope: "read / write", blurb: "upcoming meetings, free/busy, group availability, schedule / cancel / check in, manual blocks" },
  { area: "Tasks & projects", scope: "read / write", blurb: "your tasks + boards, create/update tasks, manage_sprint / manage_epic / manage_story, project overview & settings" },
  { area: "Docs, notes & search", scope: "read / write", blurb: "global search, pages & lab documents, comments, personal notes, doc tags, version history" },
  { area: "Timesheets", scope: "read / write", blurb: "your roles + logged time, manage_time_entry (with a confirm-first preview)" },
  { area: "Hiring", scope: "read only", blurb: "cycles, applications + full context, reviews, decisions, interviews, waitlist — read-only by design" },
  { area: "Education", scope: "read / write", blurb: "offerings, assignments, CE standing; apply/withdraw; instructors manage offerings, sessions, attendance, decisions" },
  { area: "Mentorship", scope: "read / write", blurb: "mentor notes + pairs (mentors & Core only; never visible to mentees)" },
  { area: "Signing & forms", scope: "read / write", blurb: "documents to sign + sign them; submit forms; Core manages agreements & the form library" },
  { area: "Partners", scope: "read / write / admin", blurb: "partner orgs, applications pipeline, membership; promote an application to a project (admin)" },
  { area: "Lab admin", scope: "admin", blurb: "announcements, groups, domain leads, audit logs, background jobs, staffing finalize — Core/Admin only" },
];

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
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Connect AI to DALI OS</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        DALI OS exposes an MCP server so AI assistants can read your DALI data
        on your behalf.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Claude Code</h2>
        <CopyBlock content={`claude mcp add --transport http dalios ${mcpUrl}`} />
        <p className="mt-2 text-sm text-muted-foreground">
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
        <p className="mt-2 text-sm text-muted-foreground">
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
        <p className="mt-2 text-sm text-muted-foreground">
          Any MCP-compatible client that speaks Streamable HTTP can use{" "}
          <code className="font-mono">{mcpUrl}</code> as the endpoint. The
          OAuth metadata document is at{" "}
          <code className="font-mono">/.well-known/oauth-authorization-server</code>.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">What can an assistant do?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          DALI OS exposes a large MCP catalog (~140 tools) across the areas
          below. Two things always hold: reads only ever return what you're
          already allowed to see, and <code className="font-mono">mcp:admin</code>{" "}
          actions additionally require you to personally hold the relevant lab
          role (Core/Admin) — the scope alone isn't enough. Your client's{" "}
          <em>tools/list</em> shows the full, current catalog with per-tool
          descriptions.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-4 font-medium">Area</th>
                <th className="py-1 pr-4 font-medium">Scope</th>
                <th className="py-1 font-medium">Examples</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_CATEGORIES.map((c) => (
                <tr key={c.area} className="border-t border-border align-top">
                  <td className="py-1.5 pr-4 font-medium text-foreground whitespace-nowrap">{c.area}</td>
                  <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{c.scope}</td>
                  <td className="py-1.5 text-muted-foreground">{c.blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Scopes: <code className="font-mono">mcp:read</code> (reads),{" "}
          <code className="font-mono">mcp:write</code> (your own + role-scoped
          work), <code className="font-mono">mcp:admin</code> (elevated lab
          admin — only granted to Core/Admin at authorization time).
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Resources (auto-attachable context)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Clients can attach these as <em>resources</em>, separate from tool calls.
          Some clients (Claude Desktop) let you pin them so they ride along on every message.
        </p>
        <ul className="mt-3 text-sm text-foreground list-disc pl-5">
          <li><code className="font-mono">dali://me</code> — your profile, roles, domain eligibilities</li>
          <li><code className="font-mono">dali://announcements/active</code> — your unread lab announcements (markdown)</li>
          <li><code className="font-mono">dali://forms/pending</code> — published forms you've been asked to fill</li>
          <li><code className="font-mono">dali://project/{"{projectId}"}/board</code> — full sprint board for a project</li>
          <li><code className="font-mono">dali://project/{"{projectId}"}/backlog</code> — unscheduled tasks for a project</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Prompts (templated workflows)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          These appear as commands in the client (e.g. <code className="font-mono">/dali:weekly-digest</code> in
          Claude Code). The model carries them out by calling the MCP tools above.
        </p>
        <ul className="mt-3 text-sm text-foreground list-disc pl-5">
          <li><code className="font-mono">weekly-digest</code> — focus, meetings, inbox, suggested next action</li>
          <li><code className="font-mono">meeting-prep</code> — agenda + talking points for an upcoming meeting</li>
          <li><code className="font-mono">project-status</code> — status report draft for a project you're on</li>
          <li><code className="font-mono">sprint-planning</code> — draft a candidate next sprint for a project</li>
          <li><code className="font-mono">standup</code> — short standup summary from the current board</li>
          <li><code className="font-mono">retro</code> — retrospective notes for a recent sprint</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Managing connections</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Visit{" "}
          <a className="text-accent-teal hover:underline" href="/settings/connected-apps">
            Settings → Connected apps
          </a>{" "}
          to review or revoke an authorization at any time.
        </p>
      </section>
    </main>
  );
}
