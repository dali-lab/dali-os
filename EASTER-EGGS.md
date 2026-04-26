# Launch Party Easter Eggs

Two unlock codes on `/party`. Members get the internal code; everyone else gets the external code.

- **External code** (applicants): `D4LI`
- **Internal code** (members): `C5DE`

Both watermarked faintly under each code-entry row on `/party`. The input accepts both letters and digits.

Code constants live in [dali-api/app/lib/party.ts](dali-api/app/lib/party.ts).

---

## How to reach `/party`

There's no link. Click the **DALI logo** in the top nav.

- **5 clicks** → retro mode toggles on. The console prints: *"what if you click a few more times?"*
- **10 clicks** → redirects to `/party`.

The trail works on both layouts:
- Members: [dali-api/app/components/Layout.tsx](dali-api/app/components/Layout.tsx) (already wired).
- Applicants: [dali-api/app/routes/applicant-layout.tsx](dali-api/app/routes/applicant-layout.tsx).

Click logic lives in `bumpLogoClick()` in [dali-api/app/lib/party.ts](dali-api/app/lib/party.ts).

---

## How clues work

Each clue has two parts:

1. **Slot symbol + position** — a small superscript number (`¹`, `²`, `³`, `⁴`) marking which input box the answer fills.
2. **Decoded value** — a digit, fact, or symbol that resolves to a single letter (e.g. `Roman50` → `L`, `0x43` → `C`).

Read the decoded letters in slot order to get the code.

---

## External — `D4LI` (slots 1–4)

### Slot `¹` → `D` (decode `Roman500`)
- **File**: [dali-api/app/routes/portal.tsx](dali-api/app/routes/portal.tsx)
- **Where**: footer at the bottom — "Made with care at DALI Lab."
- **How to find**: drag-select past the period. A same-color-as-bg span reveals **`1Roman500`**.
- **Decoding**: Roman numeral 500 = `D`.

### Slot `²` → `4` (decode `√16`)
- **File**: [dali-api/app/routes/applicant-layout.tsx](dali-api/app/routes/applicant-layout.tsx)
- **Where**: a faint `·` next to the "Applicant Portal" subtitle in the top nav.
- **How to find**: hover the `·` — it swaps in coral monospace text **`2 = √16`**.
- **Decoding**: √16 = `4`.

### Slot `³` → `L` (decode `Roman50`)
- **File**: [dali-api/app/routes/login.tsx](dali-api/app/routes/login.tsx)
- **Where**: a faint `·` next to the **Sign in** heading on `/login`.
- **How to find**: hover the `·` — it swaps in coral monospace text **`3Roman50`**.
- **Decoding**: Roman numeral 50 = `L`.

### Slot `⁴` → `I` (Chrome-dino game reward)
- **File**: [dali-api/app/routes/party.tsx](dali-api/app/routes/party.tsx)
- **Where**: jump-game widget on `/party`, above the code-entry row.
- **How to find**: hit a score of **100+** (jump cacti with space/click). The reward badge appears next to the game label and persists across sessions: **`4i = √-1`**.
- **Decoding**: imaginary unit `i` = √(-1) → `I`.

---

## Internal — `C5DE` (slots 1–4)

### Slot `¹` → `C` (decode `Hex0x43`)
- **File**: [dali-api/app/routes/mentor.tsx](dali-api/app/routes/mentor.tsx) (`/reviewer`)
- **Where**: bottom of the dashboard, after the last section.
- **How to find**: drag-select the empty area at the bottom. A same-color-as-bg span reveals **`1Hex0x43`**.
- **Decoding**: hex `0x43` = ASCII `C`.

### Slot `²` → `5` (decode `101 (binary)`)
- **File**: [dali-api/app/routes/mentor.tsx](dali-api/app/routes/mentor.tsx) (`/reviewer`)
- **Where**: a faint `·` next to the **Reviewer Dashboard** heading.
- **How to find**: hover the `·` — it swaps in coral monospace text **`2 = 101 (binary)`**.
- **Decoding**: binary `101` = `5`.

### Slot `³` → `D` (logo IS the answer)
- **File**: [dali-api/app/components/Layout.tsx](dali-api/app/components/Layout.tsx) (shared internal header — visible on every member page).
- **Where**: the "DALI Hiring" logo in the dark top bar.
- **How to find**: notice the `D` is colored faint coral with a tiny `³` superscript.
- **Decoding**: the letter is literally `D`, slot 3.

### Slot `⁴` → `E` (Chrome-dino game reward)
- **File**: [dali-api/app/routes/party.tsx](dali-api/app/routes/party.tsx)
- **Where**: jump-game widget on `/party`, above the code-entry row.
- **How to find**: hit a score of **100+**. The reward badge appears: **`4mc²`**.
- **Decoding**: `E = mc²` → `E`.

---

## Implementation notes

- Reward state for the dino game lives in `localStorage` under `dali:party:dino-reward`. Helpers in [dali-api/app/lib/party.ts](dali-api/app/lib/party.ts).
- Logo click count is in `sessionStorage` (`dali:party:logo-clicks`) — resets when the tab closes.
- Audience routing: members get the internal code, everyone else gets external (`auth.user.type === "member"`, [dali-api/app/routes/party.tsx:18-19](dali-api/app/routes/party.tsx#L18-L19)).
