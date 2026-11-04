---
title: Partner applications
summary: Run the partner pipeline in Core, from a new pitch through interview, decision, contract, statement of work and creating the project.
audience: [core, admin]
paths: [/core/partners, /core/partners/applications/:id, /core/partners/settings]
keywords: [partner, application, pipeline, board, interview, accept, reject, promote, create project, SOW, statement of work, contract, deal terms, stage, PI, backlog]
---

The partner pipeline is where Core tracks outside organizations that want DALI to build something for them. Each card is one application. Only Core can see this area: open [Partners](/core/partners) under Core in the sidebar. For the organizations and people behind the applications, see [Partner organizations and contacts](/help/articles/partner-directory). For renewals, planning and reports, see [Renewals, planning and reports](/help/articles/partner-planning).

## The board

[Partners](/core/partners) is a board with one column per stage:

- **Backlog**: parked ideas, not yet reviewed.
- **New**: a fresh application nobody has acted on.
- **Interview**: the team is meeting the partner.
- **Deciding**: interviews are done and Core is choosing.
- **Accepted**: the partner is in. When a project has been created from it, the card shows the project icon.
- **Rejected**: not going ahead.

Drag a card to another column to change its stage, or drag within a column to reorder. Moving a card by hand does not email the partner. Use **Accept** or **Reject** on the application when the partner should be told.

Use the search box and the filters for term, domain, source and activity. Source is how the application arrived: the application form, email, referral, a renewal, or added by Core. An open application with no activity for a while is marked stale. Applications put on hold show as paused. The **Partner settings** button (the gear) sets how many days make an application stale, who is on the interview panel, and whether paused and old rejected cards show. The same button also picks the forms partners fill out: the application form and the survey they get after a project ends.

## Add an application

Most applications arrive when a partner fills out the application form at `/partner/apply`. To add one yourself, click **New application**. Enter a title and the contact's email, plus any of the contact name, summary, source, target terms and domains. The title and the contact's email are required.

## Work an application

Click a card to open it. A full page is also available from the open-full-page button, at `/core/partners/applications/:id`. The tabs are **Overview** (called **Activity** in the pop-up), **Evaluation**, **Meetings**, **Details**, **Statement of work** and **Email**. A side panel shows the stage, contact, organization, PI, source, target terms, next step, hold date, contract and deal terms.

- **Overview** is the timeline of everything that happened. Add an internal note here, and use @ to mention a teammate.
- **Details** holds the internal summary, target terms, the domains the partner wants and how many members each needs, and the partner's answers to the application form. Partners do not see the summary.
- **Evaluation** scores the pitch from 1 to 5 on feasibility, potential for impact, originality, learning opportunity, dev challenges, design challenges, partner team and funding situation, with notes and an interview rating. It also lists prompts for discovery meetings.
- **Meetings** shows meetings with the partner. Click **Schedule meeting** (or **Schedule interview** on a New application) to book one with a calendar invite. **Log a meeting manually** records one that already happened. When a partner asks for a meeting from their portal, it appears under **Pending requests**, and Core can accept or decline it.
- **Email** shows email with the partner.

In the side panel, set a **Next step** with a due date, or pause the application with **Paused until**. **Resume now** clears the pause. Use the **PI** field to pick the principal investigator, who must be a Core member. The field goes away once a project has been created.

## Decide

- **Request more info** (in Interview or Deciding) asks what you need from the partner and emails them the request. It does not change the stage.
- **Move to deciding** moves an Interview application forward.
- **Accept** (in Interview or Deciding) asks you to confirm, then marks it Accepted and emails the partner.
- **Reject** is available until a project exists. It asks for a reason: not a fit for the lab, no capacity this term, funding, timing, partner withdrew, or other. You can add a note that the partner will see, and the partner is emailed the decision.

## Contract, statement of work and fees

The side panel's **Contract** section lets you choose a template and click **Send**. The section shows Not sent, Sent or Signed. The partner signs from their portal, and once signed the section shows the date and a **PDF** link. If no templates are listed, there is no contract template to send yet.

**Deal terms** records the funding type, fee, legal entity name and address, and payment schedule. These fill in the contract, and the organization's **Finance** tab lists them.

On the **Statement of work** tab, you and the partner draft the SOW in a shared editor. **Share with partner** emails it to them to review, and the state moves from Draft to Shared. When they accept it in their portal, the state becomes Accepted. **Mark accepted** records it yourself.

## Create the project

Once an application is Accepted and has no project, click **Create project**. Confirm and DALI OS creates a project linked to the application. It carries over the title, summary, icon, the partner organization, the PI, the first target term, and the domain headcounts as role requests at the P1 level. It then opens the new project. If the applicant has no organization yet, one is created for them.

A project is only created once per application. Opening the application again links straight to the project.
