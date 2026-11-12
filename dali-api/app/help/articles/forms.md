---
title: Forms
summary: Fill out a form, and build one with questions, sharing, responses, a summary, and reminders for people who haven't answered.
paths: [/forms/fill/:token, /forms/edit/:formId, /drive]
keywords: [form, survey, questions, responses, summary, tracker, reminder, publish, share link, qr code, csv]
---

Forms collect answers from members and sometimes from people outside the lab. Who can fill a form is set by its sharing. Anyone with Can edit access to a form can build it and read the responses.

## Fill out a form

Open the link you were sent, or open the form from your Tasks. You may need to sign in first.

- Answer the questions. A `*` marks a required question. Some questions only appear after you answer an earlier one.
- Long forms are split into pages. Use **Next** to move on and **Submit** on the last page.
- Your answers are saved in your browser as you go, so you can close the tab and come back on the same device. Saved answers expire after 30 days.
- After you submit, you see the form's confirmation message. If the builder turned on receipts, you also get an email copy of your response.

Some forms allow one response per member. If you open one you already filled out, you see the date you submitted. If the builder allows edits, an **Edit your response** button appears. If the form has a close time and it has passed, or it hasn't opened yet, you can't submit.

If you see "You don't have access to this form", the form is limited to certain people. Ask whoever sent the link.

## Create a form

1. Open [Drive](/drive), go to the folder where the form should live, and choose **New form** from the New menu.
2. Name it and select **Create**. The form editor opens.
3. Add questions with **Add a question**, drag to reorder, and mark each as required if people must answer it.

Anyone who can edit the folder can create a form there. Outside a folder, any lab member can.

### Question types

- **Text**: Short answer, Long answer, Number, Email, Date.
- **Choices**: Multiple choice, Dropdown, Checkboxes, 1 to 5 scale, Skills rating, and Database list (pick from members, projects or other lab records).
- **Links and files**: GitHub link, Figma link, Drive link, File upload.
- **Layout**: Text block (prose shown to respondents) and Page break. These aren't counted as questions and don't appear in responses.

Multiple choice and Checkboxes can include an **Other** option. A Dropdown or Database list with more than 8 choices lets respondents type to search it. Checkboxes with more than 12 choices show as a searchable list where respondents pick several. Skills rating takes one skill per line. File upload takes up to 10 files per answer, up to 50 MB each. Under **Files per answer**, pick **Up to** or **Exactly** and a number. A required question needs at least one file, and **Exactly** means that many, so an optional **Exactly 3** takes three files or none. Anyone who can fill the form can upload, including people who aren't signed in when the form is open to anyone with the link. In Responses, each file opens from the response.

### Show a question only sometimes

Open a question and set **Show this question** to **Only when**, then pick an earlier question and what its answer has to be. A page break has **Show this page**, which shows or hides every question on that page at once.

- Choices and Database lists: **is** or **is not**, with one or more answers. Pick **Other** to match a typed-in answer.
- Checkboxes: **includes** or **doesn't include**, with one or more answers.
- 1 to 5 scale: **is**, **is not**, **is at least** or **is at most**.
- Number: **is at least** or **is at most**. Date: **is on or after** or **is on or before**.
- Short answer, Long answer, Email and links: **contains** some text.
- Any of these, and File upload: **is answered** or **is blank**.

Select **Add condition** to check more than one answer, then choose whether **all** or **any** of them have to match. A hidden question is never required, and its answer isn't saved. Questions a staffing view reads, such as Project Bids columns, are always shown, so neither they nor their page can have a condition.

### Versions, preview and publish

The form's name sits at the top of the page and in the breadcrumb, and the status next to the breadcrumb, such as **v3 · Published** or **Editing v4 draft · Saved**, opens the versions menu. Your edits save as a draft automatically, and the status reads **Saving…** or **Saved**. If a save fails it reads **Couldn't save · Retry**. To rename the form, click its name at the top of the page or in the breadcrumb, type a new name and press Enter. Hover over the name to add an icon, or click the icon to change or remove it. Respondents never see the draft. While you are editing, **Publish** turns the draft into a new version and makes it live at the form's link. From a saved version that isn't live yet, **Publish** makes the latest version live. On a published version the main button reads **New version**, which opens a draft. Each version keeps its own responses, so changing questions never rewrites old answers. Use the versions menu in the status to switch between versions or continue a draft. To change a version that is already live, select the pencil next to it. That opens your draft, started from that version, and nothing changes for respondents until you publish. **Discard draft**, in the three-dot menu, deletes the draft and leaves the live version as it is. A version with no responses yet can be deleted. **Preview** shows the form as a respondent sees it.

Once a form is published, **Copy form link** copies the link people use to fill it out, and **QR code** in the three-dot menu shows a code you can download. Before it is published, **Copy form link** is greyed out. **Copy link** in the three-dot menu copies the page you are on, like on any other page. **Unpublish**, also in the three-dot menu, turns the link off but keeps it, so publishing again restores the same link. Use **Share** to choose who can fill the form and who can edit it, the same way you share a document (see [Sharing and visibility](/help/articles/sharing)). On a form the roles read **Can fill**, **Can edit** and **Full access**.

Forms that belong to another feature, such as a hiring cycle or an education offering, show **Managed by** that feature. That feature decides who can fill them and when, so publishing and sharing happen there.

### Settings

Open the three-dot menu at the top and choose **Form settings**.

- **One response per member**, and **Let people edit their response** under it.
- **Notify on submission** sends you a notification when someone responds.
- **Opens** and **Closes** times. Select **Save schedule** after changing them.
- **Remind people 1 day before closing**. This needs a close time.
- **Confirmation message** shown after submitting. Select **Save message** after editing it.
- **Email people a copy of their response**. People who aren't signed in only get a short note at the first Email question, without their answers, so add an Email question if the form is public.

## Read responses

Open a version and use the switch at the top to move between **Questions**, **Summary** and **Responses**. The count beside Responses is how many people answered.

- **Summary** charts each question. Scale and number questions show count, average, lowest and highest. Choice questions show how many picked each option.
- **Responses** lists each submission. Search by name, email or answer, open a row to read the full answer, or use **Delete response** (this can't be undone). Deleting a response also removes what it fed: a project bids response takes the member's bids for that cycle with it, an intent to work response takes their intent, and an application response deletes the application. The confirm lists what goes. A response can't be deleted once its partner application became a project, or while its course application is approved, waitlisted or has attendance.

Forms tied to staffing slots add **Slot** to the filter bar in both views.

In Responses, **Member columns** adds columns about each respondent's time in the lab: **Project history** (every project and the terms they worked on it), **Terms in lab** (the count and each term) and **Current role** (each domain and level, plus any Core title, from their latest term). They fill in only for members who were signed in when they responded, and they aren't part of **Export**.

### Filter by answer

Select **Filter** under the switch in Summary or Responses, pick a question, then choose what to match. Each active filter shows as a pill beside the button. Select the middle of a pill to change it, **×** to remove it, or **Clear all** to remove every filter. Filters stay when you switch between Summary and Responses, and they start over when you switch to another version.

- Choice, scale and project questions: pick one or more options. A response matches if it has any of them. If the question has an Other choice, you can pick **Other** to find typed-in answers.
- Text, email and link questions: **Contains** finds a word or phrase, ignoring capitals.
- Number and date questions: **Min** and **Max** (or **From** and **To** for dates) take a lowest and highest value, and either can be left empty.
- Any question: **Answered** or **No answer**. A question that was hidden for someone by a rule counts as **No answer** for them.

Each question gets one filter, and a response has to match every filter you set. File and skills rating questions can't be filtered. The Summary counts and charts follow the filters. The search box looks for names, emails and answers, but not project names, because those answers are stored as ids.

**Export** downloads the responses that match your search and filters, and reads **Export 12** when any are on. With nothing applied it downloads every response to that version.

## Follow up with people who haven't answered

When a form is sent to groups or attached to an announcement, Results shows a progress bar such as "8 of 12 expected people responded". Select **not responded** to see who is left, then **Send reminder**. You can edit the message first. A form can be reminded once every 24 hours, and only while it is published. People who dismissed the to-do aren't reminded.

To send a form to everyone, attach it to an announcement under [Core tools](/help/articles/core-tools).
