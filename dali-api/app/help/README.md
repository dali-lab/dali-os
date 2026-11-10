# Help articles

Each file in `articles/` is one help article, served at `/help/articles/<file name>` and read by Ask DALI through the `read_help` MCP tool. The file name is the slug: lowercase words joined by hyphens.

## Header

```
---
title: Booking rooms
summary: Find a free room, book it, and change or cancel a booking.
audience: [core, admin]
flag: ask-dali
paths: [/rooms, /rooms/:id]
keywords: [room, booking, reserve]
---
```

- `title`: sentence case, a few words.
- `summary`: one sentence, shown in the article list and given to Ask to pick articles.
- `audience` (optional): who can see the article, any match is enough. Leave it out for every lab member. One of `member`, `mentor`, `core`, `admin`, `staff`, `domain-lead`, `instructor`, `interviewer`. Use it when the pages it describes are limited to those people.
- `flag` (optional): a key from `app/lib/feature-flags.ts`. The article is hidden from anyone the flag is off for.
- `paths` (optional): the app paths the article covers, exactly as they appear in `app/routes.ts` or a route module, with `:param` for ids.
- `keywords` (optional): other words people might search for.

A test fails when a header names an audience, flag or path that doesn't exist.

## Writing

- Write for a member using the platform. Say what they can do and where, not how it was built.
- Plain language, sentence case, second person. No em dashes, no marketing.
- Name buttons, tabs and menu items exactly as the UI shows them, in **bold**.
- Link to pages with their path, like `[Rooms](/rooms)`.
- Say who can do what: "Only Core can close a cycle."
- Lead with a short paragraph on what the area is for, then `##` sections named for tasks ("Book a room", "Change a booking").
- Only describe what the code does today. Leave out anything behind a flag unless the article itself has that `flag`.
- Use placeholder names (Ada, ada@example.edu), never real people.
