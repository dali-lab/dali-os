# DALI Hiring — Launch-Party Easter Eggs

Organizer cheat sheet. Lists every secret, where it lives in the code, and how a player triggers it.

## Quick reference

| Secret | Trigger | File |
|---|---|---|
| Retro mode | Click the DALI logo 10 times | [app/components/Layout.tsx](app/components/Layout.tsx) |
| Confetti on login | Visit `/login?party=true` (logged out) | [app/routes/login.tsx](app/routes/login.tsx) |
| Sepia wash on login | Visit `/login?lab=1999` (logged out) | [app/routes/login.tsx](app/routes/login.tsx) |
| ASCII banner | Open devtools → Console on any page | [app/components/Layout.tsx](app/components/Layout.tsx) |
| Stats modal | ⌘⇧D (or Ctrl+Shift+D) inside the authed app | [app/components/Layout.tsx](app/components/Layout.tsx) |
| Reveal/progress page | `/party` (authed only) | [app/routes/party.tsx](app/routes/party.tsx) |

---

## Retro mode

Click the header DALI logo 10 times. Every 10th click toggles the `dali-retro` class on `<html>` and the counter resets — so click 10 more to toggle back off. State persists in localStorage under `dali:party:retro`, so it survives reloads until toggled again.

**Visual effect** (see [app/app.css](app/app.css) — `html.dali-retro` block):
- Swaps `--font-sans` and `--font-heading` to the monospace font
- Swaps `--color-accent-coral` and `--color-accent-teal` so coral/teal flip roles across the whole palette
- Adds a fixed-position repeating-gradient overlay for CRT scanlines
- Applies `contrast(1.05) saturate(1.15)` to the body

Click handler: `bumpLogoClick()` in [app/lib/party.ts](app/lib/party.ts).

## Query-string unlocks (login page only)

Both only fire when logged out and visiting `/login` directly — the loader redirects authed users away before the UI renders.

**`/login?party=true`** — confetti rain. 60 colored pieces fall from the top with randomized column, delay, and duration. Rendered by the `<Confetti />` component at the bottom of [app/routes/login.tsx](app/routes/login.tsx); CSS animation `dali-confetti-fall` in [app/app.css](app/app.css).

**`/login?lab=1999`** — toggles `dali-sepia` class on `<html>` for as long as the login page is mounted. CSS rule `html.dali-sepia body { filter: sepia(0.7) contrast(1.05) }`.

## In-code easter eggs

**ASCII banner.** On every authed-page mount, the `Layout` component logs a six-line ASCII `DALI` banner plus a teaser (`welcome, friend. try clicking the logo 10 times.`). Styled with coral color and monospace font. Only prints once per mount, not per render.

**Stats modal.** ⌘⇧D (mac) or Ctrl+Shift+D (windows/linux) anywhere inside the authed layout toggles a centered modal with hand-picked fun stats:

| Cycles run | 7 |
| Applications reviewed | 1,284 |
| Challenges written | 42 |
| Interviews scheduled | 318 |
| Lines of code | ~48k |
| Coffees consumed | ∞ |
| Launch year | 2026 |

Numbers are static. If you want real numbers, wire up a loader — see `StatsModal` in [app/components/Layout.tsx](app/components/Layout.tsx).

---

## Reveal page — `/party`

Authed-only. Minimal UI: background confetti, greeting, and **one** code row (four letter boxes + Unlock), chosen from the JWT `type` from [app/lib/auth.ts](app/lib/auth.ts):

| Who | JWT `type` | Code (case-insensitive) | localStorage on success |
|---|---|---|---|
| Applicants (portal) | anything except `member` (e.g. `dartmouth`, `partner`, dev `applicant`) | `DALI` | `dali:party:unlock-external` |
| DALI members | `member` | `LABS` | `dali:party:unlock-internal` |

Wrong code: row shakes, red border/ring flash briefly. Correct code on a fresh attempt opens the payoff modal (return visits who already unlocked only see the teal “✓” summary row, no modal).

Source: [app/routes/party.tsx](app/routes/party.tsx), constants in [app/lib/party.ts](app/lib/party.ts).

---

## LocalStorage / sessionStorage keys

Useful to know when debugging or resetting state manually:

| Key | Scope | Purpose |
|---|---|---|
| `dali:party:unlock-external` | localStorage | `"1"` if external code `DALI` solved on `/party` |
| `dali:party:unlock-internal` | localStorage | `"1"` if internal code `LABS` solved on `/party` |
| `dali:party:retro` | localStorage | `"1"` if retro mode is on, unset otherwise |
| `dali:party:logo-clicks` | sessionStorage | Running logo click count (resets per-tab) |

---

## Party-day tips

- **Seed the hunt with a QR code on a physical sign** pointing to `/login?party=true` so the first thing guests see is confetti.
- **Before the party, open devtools once per demo machine** so the ASCII banner is visible — otherwise people won't know to look in the console.
- **Retro mode is dramatic on a projector** — hit 10 clicks on the logo mid-demo for a crowd reaction.
- **To reset everything on a demo laptop:** DevTools → Application → Local Storage → delete the `dali:party:*` keys.
