# Work history import + stored resume

Status: plan, not built. Flag: `work-history-import` (all UI and both routes).

A member fills their Work experience card from a file instead of typing each job, and the
PDF they upload is kept as their resume. Ships on the profile card first; the alumni
onboarding step (later) mounts the same modal.

## 0. Decisions

- **Sources:** LinkedIn `Positions.csv` (parsed in the browser) and any PDF (resume or
  LinkedIn "Save to PDF", parsed by Claude). There's no LinkedIn API: self-serve OIDC has
  no positions, and the DMA portability API is EU-only.
- **Gateway:** Dartmouth Chat accepts PDF `document` blocks. `tool_choice` is
  unverified there, so extraction uses the repo's existing pattern instead: a JSON-only
  prompt, fence stripping and a zod `safeParse`, as `meeting-notes-enhance.server.ts`
  does.
- **Who gets it:** the member, on their own profile only. Admins can view a member's
  resume but can't upload, replace, remove or import on someone else's behalf.
- **Resume storage:** one current resume per member. Replacing it deletes the old
  object. Only the member and admins can view it.
- **No change to `WorkExperience`.** Imported rows are ordinary rows once confirmed.
- **Out of scope:**
  - The alumni step.
  - Sharing resumes with companies. That needs its own consent design, and should
    snapshot a copy for each share.
  - MCP parity. Neither MCP profile tool covers work experience today.
  - DOCX and ZIP uploads.

## 1. Schema

One additive, nullable migration (`add_user_resume`). These are fields on `User`, next
to `linkedinUrl`:

```prisma
// The member's current resume (PDF). Private: the member and admins only, served
// through /api/members/:id/resume, never api/upload/url.
resumeKey        String?   // uploads/resumes/<userId>/<uuid>.pdf
resumeFileName   String?
resumeSizeBytes  Int?
resumeUploadedAt DateTime?
```

## 2. Storage security (must ship in the same PR)

Two holes exist today:
- `api/upload/url` signs any key for any signed-in user.
- `api/upload/presign` lets any user write under any `uploads/` path except
  `payroll-imports/`.

The fixes:
- `app/lib/file-validation.ts`: export
  `RESERVED_UPLOAD_PREFIXES = ["uploads/payroll-imports/", "uploads/resumes/"]` and
  `isReservedUploadKey(key)`. It normalizes the key the same way `uploadCapForKey` does
  (leading slashes, optional `uploads/` prefix).
- `api.upload.presign.ts`: replace the inline `payroll-imports` check with
  `isReservedUploadKey`. The 400 response stays the same.
- `api.upload.url.ts`: `isReservedUploadKey(key)` returns a 404 before signing.
- Resume keys are built only on the server, from the authenticated target id. The
  client never sends a key.

## 3. Resume route: `app/routes/api.members.$id.resume.ts`

This new route is registered in `app/routes.ts` next to the other `api/members` routes.

Access rules:
- `GET` is allowed for the member (`auth.user.sub === params.id`) or `isAdmin`.
- `POST` and `DELETE` are allowed for the member only. Admins get a 404 too.
- Anyone not allowed gets a 404 (not a 403), so the route doesn't reveal whether a
  resume exists.
- If the flag is off, every method returns 404.

**`GET` (loader).** Returns 404 if there's no `resumeKey`. Otherwise it redirects 302
to `getDownloadUrl(key, { inline: true, contentType: "application/pdf", fileName:
resumeFileName, expiresIn: 300 })`. The profile's "View" link opens this route in a
new tab.

**`POST` (action), multipart `file` plus an optional `extract=1`:**
1. Validate before reading the body or doing any other work:
   - If S3 isn't configured, return 503.
   - Precheck `content-length` against 5 MB, and return 413 if it's over.
   - Parse `formData()`. A missing `file` or an empty one returns 400.
   - Check `size` again (413 if over 5 MB).
   - The first 5 bytes must be `%PDF-`, or it returns 400 "Upload a PDF."
2. Store the file:
   - `putObject("uploads/resumes/<id>/<uuid>.pdf", bytes, "application/pdf")`.
   - Update the four `User` fields.
   - Then `deleteObject(oldKey)` on a best-effort basis. It runs after the database
     write, so a failure leaves an orphaned object rather than a broken pointer.
3. If `extract=1`, the AI provider is configured and the burst and daily limits allow
   it, call `extractJobsFromPdf(bytes)`.
   - On a quota or AI failure the resume stays saved. The response carries
     `extractError` instead of failing.
4. Response:
   ```ts
   {
     resume: { fileName, uploadedAt },
     jobs?: ImportedJob[],
     extractError?: "quota" | "rate" | "ai_unavailable" | "failed",
   }
   ```

Limits are copied from the existing routes:
- Burst limit: `checkRateLimit(request, { max: 5, windowMs: 600_000 },
  "ai-work-history:<sub>")`, applied only when extracting.
- Daily quota: the shared `AiUsage` upsert, using `AI_DAILY_MAX` and
  `secondsToUtcMidnight` imported from `api.ai.meeting-notes.ts` (as Enhance does).
  It is followed by `recordTokenUsage`.

**`DELETE` (action).** Clears the four fields, then deletes the object. Returns
`{ ok: true }`. Imported jobs are untouched.

Upload uses a fetch with a FormData body, because the route returns JSON for the modal.

## 4. Extractor: `app/members/lib/resume-extract.server.ts`

```ts
export async function extractJobsFromPdf(pdf: Uint8Array):
  Promise<{ jobs: ImportedJob[]; inputTokens: number; outputTokens: number }>
```

- **Model:** `resolveAiProvider()`, then `provider.sonnetModel`. On first-party this is
  Sonnet, since Opus would be wasted on a whole-PDF extraction. On Dartmouth it falls
  back to the configured Haiku. No thinking. `max_tokens: 4096`.
- **Message:** a base64 `document` block plus an instruction. The system prompt requires
  a single JSON object, `{ jobs: [...] }`, where each job is
  `{ company, position, description, location, workMode, start: { year, month|null },
  end: { year, month|null } | null, current }`.
- **Prompt rules:**
  - Count jobs, internships, research and TA roles. Skip education, clubs, projects
    and skills unless they're a role at an organization.
  - Return one job per title when a company lists several.
  - Return null rather than guessing, and never invent a month.
  - Copy descriptions as written.
  - Put the newest job first.
- **Parsing:** `stripJsonFences`, then `JSON.parse`, then a zod `safeParse`. The fence
  stripper moves from `meeting-notes-enhance.server.ts` into `app/lib/ai.server.ts` as
  an export, and both files use it.
- **Normalization:** this is pure and lives in `work-history-import.ts` as
  `toImportedJob`.
  - Trim every string and drop empty ones to null.
  - Drop rows with no company or no position.
  - Clamp years to 1950 through next year.
  - When `current` is true, ignore the end date.
  - Map `workMode` only from the exact values `OnSite | Hybrid | Remote`.
  - Cap the result at 40 jobs.
- If the response can't be parsed, the function throws and the route returns
  `extractError: "failed"`.
- Never log the PDF, the prompt or the model output.

## 5. Shared client-safe module: `app/members/lib/work-history-import.ts`

```ts
export type ImportedJob = {
  key: string;                 // stable row id for the review list
  company: string;
  position: string;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  startMonth: string;          // "YYYY-MM" or "" when unknown
  startYear: number | null;    // prefill when the month is unknown
  endMonth: string;            // "" = none
  endYear: number | null;
  current: boolean;
};
```

- **`parseLinkedInPositionsCsv(text): ImportedJob[]`**
  - Uses papaparse with `header: true` and `skipEmptyLines: true`, stripping a BOM
    first.
  - Headers match case-insensitively: `Company Name, Title, Description, Location,
    Started On, Finished On`. If any required header is missing it throws
    `NotPositionsFileError`.
  - Dates come as `"Mar 2021"` or `"2021"`. An empty `Finished On` means current.
  - Papaparse is loaded with a dynamic `import()` in the modal, so it stays out of the
    profile bundle.
- **`toImportedJob(raw)`**: the normalization described in section 4.
- **`isDuplicate(job, existing: WorkExperienceItem[])`**: true when the company
  matches and the start month is the same. Company matching is case-insensitive and
  ignores punctuation and a trailing `inc|llc|corp|ltd`.
- **`toSavePayload(job)`**: maps a job to the `{ company, position, description,
  location, workMode, startMonth, endMonth }` shape that `parseWorkExperience` reads.

## 6. Saving: the `import-experiences` intent

This goes in `runProfileAction` (`profile-page.server.ts`), next to `save-experience`.
It is self-only (`auth.user.sub === targetId`), stricter than the existing
self-or-admin gate. If the viewer isn't the member, or the flag is off, it returns
`{ error }`.

- The `jobs` field is a JSON array of `toSavePayload` objects. Invalid JSON, an empty
  array, or more than 40 jobs returns `{ error }`.
- Each job runs through `parseWorkExperience`, using a getter over the object. If any
  job fails, nothing is written, and the error names the row, for example:
  `Row 3 (Designer at Figma): Pick a start month.`
- Valid jobs are written with
  `prisma.workExperience.createMany({ data: rows.map(r => ({ ...r, userId: targetId })) })`.
- Returns `{ imported: n }`.

## 7. UI

**Loader** (`loadProfilePage`): add the resume fields to the select. Expose
`resume: { fileName, uploadedAt, sizeBytes } | null` only when `isSelf` or the viewer is
an admin. Never send the key.

**Refactor first:** pull the form fields out of `WorkExperienceModal` into a
`WorkExperienceFields` component (company, position, dates with `MonthYearField` and a
"current" toggle, location, work mode, description). It becomes controlled so the review
rows can use it. The modal keeps working exactly as before.

**`WorkExperienceCard`** (in `MemberProfileView.tsx`), when the flag is on:
- **Header:** an "Import" button sits before "Add", in the same pill style. It shows
  only when `isSelf`. Admins keep the existing manual Add/Edit.
- **Resume line** (only when a resume exists): the `FileText` icon, the file name and
  "Uploaded Oct 20", followed by text actions:
  - **View** is shown to the member and to admins. It links to the resume route and
    opens a new tab.
  - **Replace** is shown to the member only. It uses a hidden file input and POSTs
    without `extract`.
  - **Remove** is shown to the member only. It uses `useDialog().confirm`, with the
    destructive tone, then sends a DELETE.

  After any of these, the profile revalidates.

**`app/members/components/ImportWorkHistoryModal.tsx`** is a new component. It lives
outside the route so DOM tests can import it, and is built on `Modal`, `ModalHeader`
and `ModalFooter`.

1. **Choose a file.**
   - A drop area plus a hidden input with `accept=".pdf,.csv"`.
   - Copy:
     - "Upload your resume or LinkedIn profile as a PDF. We'll save it as your resume.
       Only you and DALI admins can see it."
     - "Or, from LinkedIn: Settings, Data privacy, Get a copy of your data, Positions.
       Unzip the email attachment and upload Positions.csv."
   - A `.zip` file gets the message "Unzip it first and upload Positions.csv."
   - CSV files parse locally and go straight to step 2.
   - PDFs POST to the resume route with `extract=1`. While it runs, show "Reading your
     resume…" and disable closing.
2. **Review.**
   - One row per job: a `Checkbox`, "Title at Company" and the date range. An Edit link
     expands `WorkExperienceFields` inline.
   - Rows missing a start month show "Pick a start month". Their checkbox is disabled
     until the month is fixed.
   - Duplicates start unchecked and are labelled "Already on your profile".
   - The footer has Cancel and "Add N jobs". Add submits `import-experiences` through a
     fetcher, then closes.
   - A toast confirms the result: "Added 4 jobs."
3. **Other states:**
   - No jobs found: "We couldn't find any jobs in this file." The resume is still saved
     for PDFs, so the copy also says "Saved as your resume."
   - Each `extractError` gets its own message:
     - `quota`: "You've used today's AI limit. Your resume is saved; add jobs by hand
       or try again tomorrow."
     - `rate`: "Too many imports in a row. Your resume is saved; try again in a few
       minutes."
     - `ai_unavailable` and `failed`: "Saved as your resume. We couldn't read the jobs
       from it."

## 8. Flag

Add `{ key: "work-history-import", label: "Work history import", description: "Import
jobs from a resume or LinkedIn export, and store a resume on the profile. Ships off." }`
to `FEATURE_FLAGS`.

## 9. Tests

**`work-history-import.test.ts`** (pure functions):
- CSV:
  - The real column set, including a BOM.
  - Reordered columns and different header case.
  - A quoted description containing commas and newlines.
  - A year-only date, and a blank `Finished On` meaning current.
  - Missing headers throw.
  - An empty file.
- `toImportedJob`:
  - Trimming.
  - Dropping a job with no company or no position.
  - A `current` job ignores its end date.
  - Years are clamped.
  - An invalid workMode becomes null.
  - The 40-job cap.
- `isDuplicate`: suffix and punctuation normalization, a different month, case.
- `toSavePayload` round-trips through `parseWorkExperience`.

**`resume-extract.server.test.ts`** (`~/lib/ai.server` mocked with a fake client):
- The request has a `document` block with base64 data and uses `sonnetModel`.
- A fenced JSON response parses.
- Malformed JSON throws.
- The token counts are returned.

**`api.members.$id.resume.test.ts`** (mocks: auth, db, roles, flags, s3, ai.server,
rate-limit reset):
- GET:
  - The owner and an admin get a 302 with the signed URL.
  - Another member gets a 404.
  - No resume gives a 404.
  - Flag off gives a 404.
- POST validation:
  - Over 5 MB gives 413.
  - A file without the PDF magic bytes gives 400.
  - Missing S3 gives 503.
  - None of these calls `putObject`.
- POST storage:
  - It stores under `uploads/resumes/<id>/`, updates the fields and deletes the old
    key.
  - With no previous resume, nothing is deleted.
- POST with `extract=1`:
  - Returns jobs and records usage.
  - With the quota exhausted it still stores and returns `extractError: "quota"`.
  - With no provider it returns `ai_unavailable`.
  - When the model throws it returns `failed`.
  - Without `extract` it never calls the model.
- DELETE clears the fields and deletes the object. Another member gets a 404.
- An admin's POST or DELETE on another member's resume gets a 404 and touches nothing.

**`file-validation.test.ts` and the upload routes:**
- `isReservedUploadKey` handles both prefixes, with and without `uploads/`, and leading
  slashes.
- Presign refuses `resumes/x` and `uploads/resumes/x`.
- `api/upload/url` returns 404 for a resume key.

**Profile action** (a new test file for `runProfileAction`, mocking db, auth, roles and
flags):
- `import-experiences` writes all rows as first-of-month UTC dates.
- One bad row writes nothing and the error names that row.
- More than 40 jobs is rejected.
- Another member, and also an admin, running `import-experiences` on someone else's
  profile gets the error and nothing is written.
- Flag off returns an error.

**DOM** (`ImportWorkHistoryModal.test.tsx`):
- A CSV drives the review list.
- A row missing a month can't be checked until it's fixed.
- A duplicate starts unchecked.
- The Add count follows the checked rows.
- A `.zip` shows the unzip message.

**E2E (Playwright).** It covers the CSV path only, since CI has no S3 or AI. Flag on for
the seeded member: upload a fixture `Positions.csv`, uncheck one row, click Add, and the
card shows the jobs.

## 10. Notes for the PR description

- Additive, nullable migration.
- It closes a read and write hole on `uploads/resumes/` (and hardens
  `api/upload/url` for reserved prefixes). Only the reserved prefixes are affected. The
  route remains ungated for everything else, which deserves a separate look.
- No user-deletion path cleans up S3 today. App code never deletes a user who could
  have a resume: the `linking.ts` merge only removes a just-created Google user. So
  nothing new is needed until a real account-deletion feature exists, and that feature
  must delete `resumeKey`.

## 11. Open questions

- The alumni step's placement (deferred).
