---
title: Fill in form answers from records
summary: Start form answers with what DALI OS already knows about the person filling it, like their name or their organization, and share a form with partners.
flag: form-prefill
paths: [/forms/edit/:formId, /forms/fill/:token]
keywords: [prefill, autofill, fill in, partner, organization, project, records]
---

A form question can start with an answer already filled in from the records of the person filling it out. They see the answer in the field and can change it before they submit. What they submit is saved, not the record, so editing the answer never changes their profile or their organization.

## Fill a question in from records

1. Open the form and click a question to edit it.
2. Under **Fill in from**, pick what the answer should start as.
3. Leave it on **Nothing, start blank** for a question that should start empty.

What you can pick depends on the question type:

- **Short answer**: their name, their job title or phone (partners), or their organization's name, legal name, address or website (partners).
- **Email**: their email.
- **Long answer**: their organization's address (partners).
- **Database list** with the data source **Projects of my organization (partners)**: their project, picked for them when their organization has just one.

Organization answers fill in only when the partner belongs to one organization. If they belong to several, those questions start blank.

## Who it fills in for

Answers fill in only for people signed in. What fills in depends on who you shared the form with:

- On a form shared with **Everyone in the lab**, partner fields aren't offered, since no partner can fill it.
- On a form shared with **Anyone signed in**, partner fields are offered with a note that they start blank for everyone else.
- On a form shared with **Anyone with the link**, nothing fills in for people who aren't signed in.

If you change the sharing later and a question can no longer fill in, the question says so when you open it.

## Share a form with partners

In **Share**, set general access to **Partners**. Partners who belong to a partner organization can then fill the form. A partner contact who isn't linked to an organization yet can't, so link them in Core first. Lab members who can't edit the form can't fill it unless you add them by name. Send partners the form link from **Copy form link**.
