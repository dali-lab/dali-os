---
title: Connect an AI assistant
summary: Connect Claude Code, Claude Desktop, Codex or another AI assistant to DALI OS, choose what it may do, and revoke access later.
paths: [/help/mcp, /settings/connections]
keywords: [mcp, claude code, claude desktop, codex, ai assistant, connect, authorize, oauth, connected apps, revoke, scopes, read, write]
---

DALI OS has an MCP server, which lets an AI assistant you already use read your DALI data and, if you allow it, act for you. For example, you can ask Claude Code what is on your task list, have it draft a standup from your project board, or ask it to schedule a meeting. The assistant only ever acts as you, so it can see and do what you can and nothing more.

## Connect

The [setup page](/help/mcp) has copyable commands and the connection address for each tool. In short:

1. Open the [setup page](/help/mcp) and copy the command or config for your tool: **Claude Code**, **Codex** or **Claude Desktop**. Any other client that supports MCP over Streamable HTTP can use the same address.
2. Run it, or add it to your Claude Desktop config file and restart the app.
3. The assistant opens a browser window to DALI OS. Sign in if asked, read what the assistant is asking for, and approve it.

You can also reach the setup page from **How to connect Claude** in Settings, under **AI & connected apps**.

## What an assistant can do

When you approve, you grant one or more levels of access.

- **Read**: look at your DALI data, such as your tasks, calendar, projects, documents, notifications and profile.
- **Write**: make changes on your behalf, such as creating and updating tasks, scheduling meetings, booking rooms, submitting forms or signing documents you are asked to sign.
- **Admin**: elevated lab actions, such as announcements and background jobs. Only Core and Admin can grant this, and tools still check your role every time.

The setup page lists every area an assistant can work in, with the access each needs. Some areas are read only by design, such as Hiring. Even with write access, an assistant can't do anything you couldn't do yourself in the app.

The setup page also lists context you can attach to a conversation, such as your profile, your unread announcements, forms you have been asked to fill, and a project's board. It also lists ready-made prompts like `weekly-digest`, `meeting-prep` and `standup`.

## Review or revoke access

Open [Settings, Connections](/settings/connections) and find **AI & connected apps**. Each connected app shows its name, the access you gave it, when you authorized it and when it was last used.

Select **Revoke**, then **Revoke access**, to cut off an app right away and sign it out. You can authorize it again at any time. A connected app also appears under **Where you're signed in** in [Settings, Sign-in & security](/settings/security), where **Revoke** does the same. The list reads "No apps have access" when nothing is connected.

Revoke any app you no longer use, or that you don't recognize.
