---
title: Agreements
summary: Core creates agreements, publishes versions, puts them in force to send sign requests, and tracks who has signed.
audience: [core, admin]
paths: [/core/agreements, /core/agreements/:id, /core/agreements/:id/signature/:sigId, /core/agreements/:id/signature/:sigId/pdf, /documents/agreement/:id, /documents/agreement/:id/signature/:sigId]
keywords: [agreement, signing, sign request, term agreement, issue, put in force, publish, remind, signatories, countersign, mentor agreement, member agreement]
---

Agreements are documents members sign, such as the member, mentor and confidentiality agreements. Core runs them in two places. You write and publish them in the Drive. You issue them and track who has signed in [Core, Agreements](/core/agreements). Only Core can see either.

Members sign from the sign request email or from [Documents to sign](/sign). See [Signing documents](/help/articles/signing).

## Track signing

[Agreements](/core/agreements) shows the term you are working on. Use the term picker at the top to look at another term, for example to prepare next term early.

- **Needs attention** lists agreements with nothing in force for the term, or an unpublished draft waiting. Click **Put in force** on a card to send sign requests, or **Open in Drive** to finish the draft.
- **Completion** has one row per agreement in force, least complete first. A bar shows signed over total when the audience can be listed (returning members, new members, mentors). Other audiences show a signature count. Click the outstanding count to see who has not signed.
- **Remind** nudges everyone still outstanding on that row. It shows only when the audience can be listed, and it can be used once every 24 hours per row.
- **Recent activity** lists the latest signatures. **All agreements** lists everything and links to each one.
- **Show past terms** adds rows for earlier terms.

## Issue all term agreements at once

Click **Issue all** at the top of the console (or **Issue term agreements** on the staffing board). DALI OS lists every agreement that re-signs each term and who would be asked. Confirm to put them all in force for the selected term and send the sign requests. Finalize project staffing for the term first, because the people asked come from the staffed roster. Running it again only asks people who have not signed.

## Create an agreement

1. In the [Drive](/drive), open the **Core** drive and choose **New** then **New agreement**. Type a name and click **Create**. The agreement opens with no enforcement and no audience, so nothing is sent yet.
2. Set who it applies to with the pills at the top of the page. The agreement's name is in the breadcrumb, and the status next to it reads, for example, **v4 · In force** or **v2 · Draft**. To rename it, open the three-dot menu and choose **Rename**:
   - **Enforcement**: not enforced, hard-gate the app until signed, or gate hiring data (confidentiality).
   - **Audience**: manual (nobody is required automatically), new members, returning members, mentors, hiring participants, or everyone active this term.
   - **Cadence**: one time, each term, or each hiring cycle.
   - **Mentee countersign** appears when the audience is mentors. Set it to **Required (mentees countersign)** and add a mentee signature field to the text with **+ Mentee field**. Countersign requests go to mentees only when enforcement is set to hard-gate the app.
3. Click **New version** in the top bar (it reads **Edit draft** when a draft exists) and write the agreement. The **Insert** row places fields: signature, date, initials, checkbox, text field. **Supervisor signature** puts in a pre-signed signature for a named person, which is added when the agreement is issued. The merge menu inserts values such as the term and the signer's name.
4. Click **Preview as signer** in the top bar to check how it looks. Pick a term in the preview picker to see the term filled in.
5. Click **Save Version** (it reads **Save draft** when you are editing an existing draft). A draft can be edited again with **Edit draft** or removed with **Delete**.
6. Click **Publish** when it is final. Published versions can't be edited. Make a new version instead.
7. Click **Put in force**, confirm, and sign requests go out to the audience.

Changing enforcement, audience, cadence or countersigning on an agreement that is already in force takes effect for everyone straight away, so DALI OS asks you to confirm.

## Re-send and follow up

Open a version that is already in force. The button says **In force**, and **Re-send to unsigned** sends the request again to people who have not signed. The **In force & signatories** panel under the document shows each context (term, cycle or app-wide), who has signed and who is outstanding. Click a name to open their signed copy, where you can download a PDF.

## Archive

**Archive**, in the three-dot menu at the top of an agreement, moves it out of the active list and stops it taking signatures. It can't be undone. Signatures already collected are kept.

## Partner contracts

Contracts sent to partners use the same signing tools, and the partner signs from their portal. To make an agreement available as a contract, open it and choose **Partner contract template** from the **Type** menu at the top. Only Core can change this. The agreement appears in the contract list on a partner application once a version is published, and choosing **General** removes it from that list. See [Partner applications](/help/articles/partners).
