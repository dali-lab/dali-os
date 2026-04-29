# Launch Party Easter Eggs

Two unlock codes on `/party`. Members get the internal code; everyone else gets the external code.

- **External code** (applicants): `D4L1`
- **Internal code** (members): `C5DE`

The code-entry inputs accept both letters and digits. The answers are not shown on the page.

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
2. **Decoded value** — a digit, fact, or symbol that resolves to one code character (e.g. `Roman50` → `L`, `0x43` → `C`). On-screen hints often prefix the slot with a digit and colon (`1:…`, `4:…`) next to the puzzle text.

Read the decoded characters in slot order to get the code.

---

## External — `D4L1` (slots 1–4)

### Slot `¹` → `D` (decode lowercase ASCII `f-2`)
- **File**: [dali-api/app/routes/portal.tsx](dali-api/app/routes/portal.tsx)
- **Where**: footer at the bottom — "Made with care at DALI Lab."
- **How to find**: drag-select past the period. A same-color-as-bg span reveals **`1:f-2`**.
- **Decoding**: ASCII code of **`f`** minus **`2`** → `102 - 2` = **`100`** = lowercase **`d`** → party code **`D`** (case-insensitive entry).

### Slot `²` → `4` (decode `(100)_2`)
- **File**: [dali-api/app/routes/applicant-layout.tsx](dali-api/app/routes/applicant-layout.tsx)
- **Where**: a faint `·` next to the "Applicant Portal" subtitle in the top nav.
- **How to find**: hover the `·` — it swaps in coral monospace text **`2:(100)_2`**.
- **Decoding**: binary `100` = `4`.

### Slot `³` → `L` (decode `Roman50`)
- **File**: [dali-api/app/routes/login.tsx](dali-api/app/routes/login.tsx)
- **Where**: a faint `·` next to the **Sign in** heading on `/login`.
- **How to find**: hover the `·` — it swaps in coral monospace text **`3:Roman50`**.
- **Decoding**: Roman numeral 50 = `L`.

### Slot `⁴` → `1` (Chrome-dino game reward — digit-sum line)
- **File**: [dali-api/app/routes/party.tsx](dali-api/app/routes/party.tsx), [dali-api/app/components/DigitSumClue.tsx](dali-api/app/components/DigitSumClue.tsx)
- **Where**: jump-game widget on `/party`, above the code-entry row.
- **How to find**: hit a score of **100+** (jump cacti with space/click). The reward badge appears next to the game label and persists across sessions: coral highlights **`1`** and **`+`** in **`4:1849273+-`** (muted digits and `-` are noise).
- **Decoding**: sum only the **coral-colored digits** → `1` → slot answer **`1`**.

---

## Internal — `C5DE` (slots 1–4)

### Slot `¹` → `C` (decode `0x43`)
- **File**: [dali-api/app/routes/mentor.tsx](dali-api/app/routes/mentor.tsx) (`/reviewer`)
- **Where**: bottom of the dashboard, after the last section.
- **How to find**: drag-select the empty area at the bottom. A same-color-as-bg span reveals **`1:0x43`**.
- **Decoding**: hex `0x43` = ASCII `C`.

### Slot `²` → `5` (digit-sum line, internal coloring)
- **File**: [dali-api/app/routes/mentor.tsx](dali-api/app/routes/mentor.tsx) (`/reviewer`), [dali-api/app/components/DigitSumClue.tsx](dali-api/app/components/DigitSumClue.tsx)
- **Where**: a faint `·` next to the **Reviewer Dashboard** heading.
- **How to find**: hover the `·` — it swaps in **`2:1849273+-`**: coral highlights **`2`**, **`3`**, and **`+`**; other glyphs are muted.
- **Decoding**: sum only the **coral-colored digits** → `2 + 3` = **`5`**.

### Slot `³` → `D` (logo IS the answer)
- **File**: [dali-api/app/components/Layout.tsx](dali-api/app/components/Layout.tsx) (shared internal header — visible on every member page).
- **Where**: the "DALI Hiring" logo in the dark top bar.
- **How to find**: notice the `D` is colored faint coral with a tiny `³` superscript.
- **Decoding**: the letter is literally `D`, slot 3.

### Slot `⁴` → `E` (Chrome-dino game reward)
- **File**: [dali-api/app/routes/party.tsx](dali-api/app/routes/party.tsx)
- **Where**: jump-game widget on `/party`, above the code-entry row.
- **How to find**: hit a score of **100+**. The reward badge appears: **`4:mc²`**.
- **Decoding**: `E = mc²` → `E`.

---

## Implementation notes

- Digit-sum clue string and which indices are coral live in [dali-api/app/components/DigitSumClue.tsx](dali-api/app/components/DigitSumClue.tsx) (`DIGIT_SUM_CLUE_BODY`, `DIGIT_SUM_CORAL_EXTERNAL_SLOT4`, `DIGIT_SUM_CORAL_INTERNAL_SLOT2`).
- Reward state for the dino game lives in `localStorage` under `dali:party:dino-reward`. Helpers in [dali-api/app/lib/party.ts](dali-api/app/lib/party.ts).
- Logo click count is in `sessionStorage` (`dali:party:logo-clicks`) — resets when the tab closes.
- Audience routing: members get the internal code, everyone else gets external (`auth.user.type === "member"`, [dali-api/app/routes/party.tsx:18-19](dali-api/app/routes/party.tsx#L18-L19)).
