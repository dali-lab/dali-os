# Partner Account-First Flow

**Status:** Design spec (no code yet) · **Date:** 2026-08-02 · **Owner:** Kiran

Reframes the partner intake so a prospective partner applies with **just an individual
account** and the **organization is created only when a project actually forms**. Also
ports the real application form into the in-app Forms system as an editable multi-step
wizard, and builds the internal review surface the partner-lead process actually needs.

Supersedes the org-first assumptions in [[project_partner_portal]]. Builds on the portal
redesign ([[project_partner_portal_redesign]]) and the e-sign service
([[project_document_signing]]).

---

## 1. Problem

The entire partner model is **organization-first**, and it front-loads work onto people
who don't yet have (or haven't settled) an organization:

- `PartnerApplication.partnerOrgId` is a **required FK** — an application literally cannot
  exist without an org. It has no `applicantUserId`; the person isn't tracked.
  (`prisma/schema.prisma:4490`)
- `PartnerUser.partnerOrgId` is **required** and `userId` is `@unique` — one person,
  exactly one org, always. (`schema.prisma:4203`)
- `requirePartner` redirects any signed-in person without a `PartnerUser` row to
  `/partner/onboarding`, whose self-signup path **hard-requires an org name** before the
  person can reach `/partner/apply`. (`partner-auth.server.ts:55`,
  `partner.onboarding.tsx:66-85`)
- The **real application form** (see `partner_application_content.txt`) makes it worse: its
  "General Information" section **requires `📃 Legal entity name` and `✉️ Legal entity
  address`** — pure contract paperwork, demanded before any evaluation question, and
  impossible to fill for a partner without a formal entity.

Reality (from the partner-lead notes): partners inquire loosely (email / form / a contact),
often **without a formal org**, and the org — plus scope, term, and funding — **firm up
during the courtship**, not at first contact. The org only becomes load-bearing at the very
end, when there's an actual `Project` to attach it to via `ProjectPartner` and teammates to
invite.

## 2. Goal

Match the data model and UX to the real lifecycle:

> **submit application → interview → (if we move forward) SOW + feedback → iterate →
> contract → make project teams → project hub**

The application asks about the **project** and the **person**. The **legal entity** is
collected only when we draw up a contract. The **organization** is created only at project
promotion, when its identity is finally settled.

## 3. Locked decisions (this session)

| # | Decision | Choice |
|---|---|---|
| D1 | How far to defer `PartnerOrg` creation | **At project promotion (latest)** — application is account-owned; org created at "promote to project" |
| D2 | Partner-facing application scope | **Partner-friendly form only** — the editable bound Form; lab-internal fields (terms, per-domain headcount) move Core-side |
| D3 | Build the internal eval surface now? | **Yes** |
| D4 | Application form layout | **Multi-step wizard** (3 parts, matching the current Google Form) |
| D5 | Internal reviewer eval granularity | **Full 8-criteria structured eval** |

## 4. Rubric reconciliation (do this once, don't add a 4th)

Three overlapping rubrics exist today:

- **Public site "What We Look For" (5):** Impact Potential · Educational Value · Skill
  Compatibility · Technical Feasibility · Partner Involvement
- **Application form "five categories" (5):** social/environmental impact · design & dev
  challenges · committed founding team · feasibility · originality
- **Lead reading rubric (8):** feasibility · potential for impact · originality/innovation ·
  learning opportunity for students · type of dev challenges · type of design challenges ·
  passionate/committed/qualified team · funding situation

**Canonical reviewer rubric = the 8** (most granular; what reviewers actually fill in). Keep
the **5** as the partner-facing "what we look for" framing on the apply intro. Reconcile
marketing copy separately (out of scope here).

---

## 5. Reframed partner journey (stage → entities → exists vs. build)

| Stage | Partner sees | Data | Status today |
|---|---|---|---|
| **① Apply** | Sign in (Google / magic link) → multi-step application. Account is the only prerequisite. | `User` + `PartnerApplication{applicantUserId, partnerOrgId=null}` + `FormSubmission` | **Build:** decouple app from org; account-first apply |
| **② Review + interview** | Nothing (internal) | Eval + meeting notes on the application | **Build:** structured eval, notes, checklist (only free-form `summary` exists) |
| **③ SOW + feedback** | Shared SOW doc, can comment | `PartnerApplication.sowDocId` (Yjs collab doc `partnersow:{id}:body`) | **Partial:** doc exists but is Core-only; add partner visibility + comments |
| **④ Contract** | Signable contract in-portal | e-sign `SigningDocument`/`Binding`/`Signature` | **Partial:** service exists; needs partner audience/scope + per-app binding + legal vars |
| **⑤ Make project teams** | — | Promote → `Project` + `ProjectPartner` + **org created here** | **Adapt:** promote flow exists; create-or-attach org at this step |
| **⑥ Project hub** | Tabbed project workspace | existing redesign | **Done** (PR #1063) |

Pre-project, the portal home's north star flips from "how's my project going" to
**"how's my application going"** (status → next step → SOW to review → contract to sign).

---

## 6. Data model changes

All additive except two nullability changes. No local Postgres in this repo — generate the
client / diff a migration with a throwaway inline `DATABASE_URL` (see
[[project_partner_portal_polish]] env gotcha); CI applies it.

### 6.1 `PartnerApplication`
- **Add** `applicantUserId String` (FK → `User`). The person who applied. Nullable for the
  backfill window, then required for new rows.
- **Change** `partnerOrgId String` → `partnerOrgId String?` (nullable). Set at promotion.
- **Add** `evaluation Json?` — the 8-criteria structured eval (see §8). **JSON (confirmed).**
  Mirrors how `expectedChallenges` / form answers already store rich structured data; eval is
  displayed, not queried. Shape: `{ criteria: { feasibility, impact, originality, learning,
  devChallenges, designChallenges, team, funding }, concerns, shouldMeet: boolean,
  recommendation, ambiguityRating }`.
- **Add** `acceptChecklist Json?` — seeded from the accept template (see §8.3).
- **Add** `legalEntityName String?`, `legalEntityAddress String?` — captured at contract
  prep (§10), copied onto the org at promotion (§11).
- **Keep** `formSubmissionId`, `sowDocId`, `status`, `targetTerms[]`, `domains[]` — but
  `targetTerms` and per-domain scope are now populated **by Core during scoping**, not by
  the partner at apply (D2).

**Backfill:** existing rows have `partnerOrgId`, no `applicantUserId`. Backfill
`applicantUserId` from `partnerOrg.primaryContactId → PartnerUser.userId` where derivable;
leave null otherwise (Core-created legacy rows).

### 6.2 New: `PartnerApplicationNote` (dated meeting/review notes)
```
id            String   @id @default(cuid())
applicationId String   // FK → PartnerApplication, onDelete: Cascade
authorId      String?  // loose ref → User (display/audit)
kind          String   // "meeting" | "note"
body          Json     // BlockNote doc; meeting notes seed the first-meeting template
createdAt     DateTime @default(now())
@@index([applicationId])
```
One-to-many. Fills the "Meeting Notes section (first-meeting template)" from the lead notes.

### 6.3 `PartnerOrg`
- **Add** `legalName String?`, `legalAddress String?` — populated at promotion from the
  application's captured legal-entity fields (§11). Distinct from the display `name`.

### 6.4 `requirePartner` / auth
- New **"partner applicant"** state: authenticated `User`, has ≥1 `PartnerApplication`, no
  `PartnerUser`/org. `requirePartner` must stop force-redirecting these people to
  org-creation and instead admit them to the applicant portal (§7).
- `PartnerUser.userId @unique` (one-org-per-person) stays — it's load-bearing for the tier
  resolver and `requirePartner`. Applicants simply don't have a `PartnerUser` row yet; it's
  created at promotion.

---

## 7. The application form (multi-step wizard)

The partner-facing application **is** the bound `Form`
(`PartnerApplicationFormBinding` — already a lab-global singleton), rendered on
`/partner/apply`, fully editable in the Forms builder. This satisfies "coupled with the
process but still editable in the form UI."

### 7.1 Port the real form (replace the thin 4-question seed)

The current in-app seed ("Partner application questions", 4 textareas) is a placeholder. Port
`partner_application_content.txt` into the Forms system as three wizard steps:

| Step | Questions (all textarea unless noted) |
|---|---|
| **General** | Project title (text) · Main contact phone (text, optional) · Affiliation type (select) · Preferred start (select: No preference/Fall/Winter/Spring) · Team members (textarea, optional) · Internal reference / how did you hear (text) · Website (drive/text, optional) |
| **1 · The Problem** | Problem · Proposed solution · Differentiation · Who will use this · Who it impacts & how · Long-term impacts |
| **2 · Existing Work** | Stage · User research · Competitive research · Content/data & ownership · Timeline |
| **3 · Collaboration w/ DALI** | Why DALI · Which aspects need help · **Funding available** · Time pressure/restrictions · Anything else · Attachments (file ×3, optional) |

### 7.2 Field partition — what moves out of the application

| Field (from real form) | Verdict |
|---|---|
| Main contact **name / email** | **Drop** — auto-filled from the account |
| **📃 Legal entity name** (was required) | **→ Contract prep** (§10), promoted onto org (§11) |
| **✉️ Legal entity address** (was required) | **→ Contract prep** (§10) |
| Target terms, per-domain expected headcount/challenges | **→ Core scoping** (already Core-editable on the detail page) — remove from partner apply |

Net: removing two required fields + auto-satisfying contact from the account turns the form
from org-first into account-first with **no loss of evaluation signal**.

### 7.3 Forms-system changes required for the wizard

Questions are a **flat JSON array** today (`FormVersion.questions`; `Question` =
`key`/`type`/`required`/`data`, `app/types.ts:95`). No section/page concept exists
(`forms-data.ts:20` `isQuestionArray`). To support D4:

1. **Add optional `section`/`step` metadata** to the question shape (e.g. `data.step: number`
   or a top-level `section: string`). **No DB migration** — `questions` is already JSON;
   update the `isQuestionArray` validator to tolerate the new field.
2. **Builder UI** (`FormBuilder.tsx`): assign questions to steps + name steps. Use the
   existing `info` prose type for each step's intro copy.
3. **Fill UI** (`partner.apply.tsx` + `FormFieldList`): paginate by step with Back/Next;
   persist `formAnswers` across steps (state already exists); run `validateAnswers`
   (`public-form.ts:107`) per-step on Next, and once at final submit.
4. **Enable file upload on apply** (separate work item): remove the "File uploads aren't
   available here" override (`partner.apply.tsx:340`), allow `file` questions through the
   partner path in `validateAnswers` (`public-form.ts:150` currently 422s required files),
   and confirm the presign path (`api.upload.presign.ts`, `requireAuth`) authorizes partner
   accounts. Attachments are optional, which sidesteps the required-file rejection for v1 if
   we want to defer the deeper change.

**Reusability note:** sections/steps make the wizard useful to *any* long form (hiring,
education), not just partners — build it generically on `Form`, not partner-only.

---

## 8. Internal review surface (D3 + D5)

Replace the lone free-form `summary` textarea (`partners.applications.$id.tsx:541`) with the
surface the lead process actually describes. All Core-only; partners never see it.

### 8.1 Structured 8-criteria eval
One field per canonical criterion (§4) + **questions/concerns** + a **"should we meet?"**
flag + an overall **recommendation**. Stored in `PartnerApplication.evaluation` (§6.1).
Keep `summary` as the one-paragraph internal synopsis (or fold into `recommendation`).

### 8.2 Meeting notes
A dated log (`PartnerApplicationNote`, §6.2). "New meeting note" seeds the **first-meeting
template**. Rendered newest-first on the application detail page.

### 8.3 Accept checklist
From the lead notes, stored in `PartnerApplication.acceptChecklist`:
- [ ] Decide term
- [ ] Decide ambiguity rating
- [ ] Write Scope of Work
- [ ] Decide funding model + start paperwork
- [ ] Write Project Selection page
- [ ] Introduce team + invite to kickoff
- [ ] Transfer knowledge + material to team drive

Some items link to existing surfaces (SOW doc, scoping/terms/domains, promote-to-project).

---

## 9. SOW + feedback loop (stage ③)

The SOW collab doc already exists per application (`partnersow:{id}:body`) with version
history for free, but is **Core-only** today. Add:
- A **share-with-applicant** toggle on the application; when on, the applicant sees the SOW
  read/comment in their portal.
- **Comments** for the applicant (the comments API was already extended for partner writes on
  partner-visible files in the polish pass — same pattern, [[project_partner_portal_polish]]).
- The applicant's portal home surfaces "SOW ready for your feedback" as the current next step.

Caveat (carried from [[project_partner_portal]]): Hocuspocus doesn't re-authorize live
sockets on unshare — flag in PR.

---

## 10. Contract (stage ④) — wiring the e-sign service

The service does the hard part (placeable fields, `{{var}}` resolution, frozen archival copy;
`app/signing/`). **Signers must be an authenticated `User`** — which our applicants now are,
so a partner applicant **can sign today**. Gaps to close:

1. **Audience + scope:** add a partner audience and a `partner-app:{applicationId}` scope
   (today: `ActiveMembers`/`Mentors`/`Manual`/`HiringParticipants`; `app`/`term:`/`cycle:`).
2. **Per-application binding:** create a binding programmatically when Core clicks "Send
   contract" (today bindings are admin-only via Activate). Notify the applicant via the
   existing partner-notify pipeline.
3. **Legal-entity variables:** add `{{orgName}}`, `{{legalEntityName}}`, `{{legalEntityAddress}}`,
   `{{term}}` to `signing-variables.ts`. Legal-entity values are entered at contract prep
   (Core-entered or partner-confirmed) and stored on the application (§6.1). **Fee is
   free-text in the contract body** — not a variable pulled from the public tiers.
4. **Do NOT app-gate the partner:** the "hard gate" here is a **workflow** gate on *our*
   side (don't make teams until signed), not an app-access gate on the partner. Surface
   contract status in the pipeline + the applicant portal; don't wire partner accounts into
   the `gateScope: App` layout gate (`layout.tsx:65`, which only fires for lab members).
5. **Counter-signing (stretch):** `recordSignature` hard-codes the `"member"` role
   (`sign.server.ts`); DALI counter-signature needs multi-role support. v1 can be
   partner-signs-only and record the DALI side out-of-band.

## 11. Org materialization at promotion (stage ⑤)

"Promote to project" already creates `Project` + role requests + `ProjectPartner`
(`partners.applications.$id.tsx:222`). Adapt it to **create-or-attach the org here**:
- If the application has no org (the normal new-flow case), create `PartnerOrg` now using the
  settled identity: `name` from the application/contract, `legalName`/`legalAddress` copied
  from the application's captured fields (§6.3), `isIndividual` when it's a solo professor.
- Create the `PartnerUser` row linking `applicantUserId → org` (their first org membership).
- Link `ProjectPartner(org, project)` as today; set `resultingProjectId`.
- The applicant "graduates" into a partner-with-org and can now invite teammates.

## 12. Migration & risk notes

- **Two nullability changes** (`PartnerApplication.partnerOrgId` → nullable;
  `applicantUserId` add) + backfill. Additive JSON columns and the new note table are safe.
- **Collab-sensitive:** SOW sharing touches doc authorization — flag in PR per CLAUDE.md
  realtime caveats. No Y.Doc schema change (SOW keying stays `partnersow:{applicationId}`).
- **Auth path breadth:** the applicant state changes `requirePartner`, the login/onboarding
  redirects, and the Google/magic-link callbacks — test all three entry points.
- **`isIndividual` auto-org** moves from signup to promotion; verify no residual signup path
  creates orgs.
- **Env:** no local DB; generate/diff migrations with a throwaway inline `DATABASE_URL`
  (never `prisma migrate dev` against the Neon URL in `.env`).

## 13. Suggested phasing

1. **Account-first application** (the friction fix): schema (`applicantUserId`, nullable
   `partnerOrgId`, backfill), applicant auth state, `/partner/apply` + onboarding rework,
   drop legal-entity + move terms/domains Core-side. Ship this alone — it delivers the core
   value.
2. **Wizard + form port:** generic Forms sections/steps, builder + fill UI, port the real
   form, enable attachments.
3. **Internal review surface:** 8-criteria eval, meeting notes, accept checklist.
4. **SOW feedback loop:** partner-visible SOW + comments + portal "next step".
5. **Contract:** e-sign partner audience/scope, per-app binding, legal vars.
6. **Org at promotion:** create-or-attach org, graduate applicant, backfill polish.

Phases 1–3 are independent and high-value; 4–6 complete the courtship pipeline.

---

## Resolved (2026-08-02)

- **Eval storage:** JSON blob (`PartnerApplication.evaluation`). Not queried, so no need for
  discrete columns.
- **Multi-contact during courtship:** **single-applicant until the org forms.** No pre-org
  collaborator invites; a second contact gets access once the org exists at promotion.
- **Contract fee:** **free-text** in the contract body — no `{{feeAmount}}` variable.
