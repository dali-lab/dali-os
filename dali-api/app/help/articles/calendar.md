---
title: Calendar
summary: Link Google accounts, choose which calendars count as busy, set working hours, and use the calendar views.
paths: [/calendar, /settings/connections]
keywords: [google calendar, busy, availability, working hours, buffer, views, month, week, day, agenda, link account, main calendar]
---

The [Calendar](/calendar) shows your Google calendars, DALI OS meetings and (if you turn it on) the hours you logged, in one place. DALI OS also reads your Google calendars to work out when you are free, so other people can find a time that works for you.

## Link a Google account

1. Open [Calendar](/calendar) and click the gear button (**Calendar settings**).
2. In the **Calendars** section, click **Add account**.
3. Sign in on Google and allow access. You come back to DALI OS.

You can also add an account from [Settings, Connections](/settings/connections) under **Google Calendar**. You can link more than one account, for example a personal one and a Dartmouth one.

If an account shows a sync error with a **Reconnect** link, click it and allow the Calendar permission on Google.

To remove an account, click the trash icon next to it and confirm **Disconnect**. DALI OS stops using that account for scheduling and availability. Events already on Google stay on Google.

## Choose which calendars count

Each linked account lists its calendars with three columns:

- **Main**: the star marks the calendar where new events you create in DALI OS are saved. Only a calendar you can write to can be your main calendar. Calendars marked read-only cannot.
- **Show**: whether the calendar is drawn on your grid. This is a display choice kept in your browser, so it does not change your availability.
- **Availability**: whether events on the calendar make you busy. Turn this on for calendars you actually attend, such as your primary calendar. Turn it off for calendars you only follow, such as holidays or sports schedules.

Only some events make you busy. Timed events count. All-day events, events you marked **Free** in Google, cancelled events and events you declined do not.

**Manage calendars** lets you create a new Google calendar or delete one you made. If the shared DALI General Calendar is not on any of your accounts, the settings show **Add the DALI General Calendar** so you can subscribe to it.

## Working hours and buffers

In **Calendar settings**, open **Working hours** and switch on **Working hours enabled**. Set the hours you are bookable on each day. Use **Add segment** to add more than one block in a day, for example a morning and an afternoon. A day you leave off shows as **Unavailable**. The reset button puts the hours back to the defaults. Hours use your saved time zone.

Your free time is your working hours minus your busy events. If working hours are off, you count as free any time you are not busy. DALI OS pads 15 minutes on each side of every busy event, so nobody is booked straight up against one. There is no setting for the buffer in the app today.

The **Classes** section lists your classes this term so nobody books over them.

## What DALI OS writes to Google

- Events you create with **Add event** are saved to your main calendar.
- Meetings you schedule are saved to the calendar you pick under **Send invite from**, and the guests get a Google invite. Adding a Google Meet link puts it on that event.
- Changes you make to an event you can edit, and deleting it, are sent to Google.
- Your **Going**, **Maybe** or **Can't go** answers on events are sent to Google.
- **Track in DALI OS** (on a Google event that is not yet a DALI OS meeting) does not change the Google event. It gives the event a DALI OS meeting page for notes and attendance. You can track an event you are on, and Core can track any event. **Stop tracking** removes that, and the Google event stays on everyone's calendar.

DALI OS does not edit events on calendars you cannot write to.

## Views and buttons

- **Month**, **Week**, **Day** and **Agenda** switch the view. They sit above the small month calendar on the left.
- **Today**, the arrows and the small month move you through dates.
- **Calendar** and **Timesheet** switch the grid between your events and your logged hours. In Timesheet mode on the Week or Day view, the main button reads **Log hours**.
- **Add event** creates an event. Add guests and it becomes a meeting. See [Meetings](/help/articles/meetings).
- The door icon (**Room booking**) opens [Rooms](/rooms).
- Click any event to see its details, answer an invite, propose a new time, edit it or delete it.
- Shaded bands on the Week and Day views are your working hours.
- If you delete a repeating event, you choose **This event**, **This & following** or **All events**.
