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

Multiple choice and Checkboxes can include an **Other** option. Skills rating takes one skill per line. Each question can be shown only when an earlier answer matches, using **Show this question**.

### Versions, preview and publish

The form's name is in the breadcrumb at the top, and the status next to it, such as **v3 · Published** or **Editing v4 draft · Saved**, opens the versions menu. Your edits save as a draft automatically, and the status reads **Saving…** or **Saved**. If a save fails it reads **Couldn't save · Retry**. To rename the form, open the three-dot menu and choose **Rename**. Respondents never see the draft. While you are editing, **Publish** turns the draft into a new version and makes it live at the form's link. From a saved version that isn't live yet, **Publish** makes the latest version live. On a published version the main button reads **New version**, which opens a draft. Each version keeps its own responses, so changing questions never rewrites old answers. Use the versions menu in the status to switch between versions or continue a draft. To change a version that is already live, select the pencil next to it. That opens your draft, started from that version, and nothing changes for respondents until you publish. **Discard draft**, in the three-dot menu, deletes the draft and leaves the live version as it is. A version with no responses yet can be deleted. **Preview** shows the form as a respondent sees it.

Once a form is published, **Copy link** copies the fill link, and **QR code** in the three-dot menu shows a code you can download. Before it is published, **Copy link** is greyed out. **Unpublish**, also in the three-dot menu, turns the link off but keeps it, so publishing again restores the same link. Use **Share** to choose who can fill the form and who can edit it, the same way you share a document (see [Sharing and visibility](/help/articles/sharing)). On a form the roles read **Can fill**, **Can edit** and **Full access**.

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

Choose **Results** for a version. It has two views.

- **Summary** charts each question. Scale and number questions show count, average, lowest and highest. Choice questions show how many picked each option.
- **Responses** lists each submission. Search by name or email, open a row to read the full answer, or use **Delete response** (this can't be undone). **Export CSV** downloads every response to that version.

Forms tied to staffing slots add a slot filter to both views.

## Follow up with people who haven't answered

When a form is sent to groups or attached to an announcement, Results shows a progress bar such as "8 of 12 expected people responded". Select **not responded** to see who is left, then **Send reminder**. You can edit the message first. A form can be reminded once every 24 hours, and only while it is published. People who dismissed the to-do aren't reminded.

To send a form to everyone, attach it to an announcement under [Core tools](/help/articles/core-tools).
