---
title: Slide decks
summary: Create a slide deck in Drive, edit its slides, and preview it full screen.
flag: drive-slides
paths: [/slides/:pageId]
keywords: [slides, deck, presentation, present, preview]
---

A slide deck is a presentation you build and show inside DALI OS. Slide decks are only available when they are turned on for you.

## Create one

In [Drive](/drive), open the drive or folder where it should live, click **New**, choose **New slide deck**, and name it.

## Edit a deck

A deck is a list of slides. Each slide uses one of four layouts, picked with the layout switch above the slide: **Title**, **Text**, **Text + image** or **Image**.

Open a deck and use the **Mode** switch at the top:

- **Edit**: the slide list is on the side, with **Add** to add a slide. Each slide has fields for the title, subtitle, body, image (paste a URL or click **Upload**), alt text and notes, depending on its layout. Move a slide up or down, **Duplicate** it, or **Delete slide**. Every slide except an Image slide needs a title, and Text + image and Image slides need an image. A warning shows when some are missing.
- **Preview**: see the deck full screen. At the end, **Back to editing** returns you to the editor.

Changes save as you go, and a status next to the switch shows the state. If someone else saved first, you see **Reload**. If saving failed, click **Try again**.

If you only have view access, the deck opens straight into the viewer.

## Place and arrange items

When the live deck editor is on for you, you can put text, images and shapes anywhere on a slide, not just in the layout's boxes. Choose the **Blank** layout for an empty slide.

- **Add an item**: open **Insert** in the toolbar. Choose **Text box** or a shape, then click the slide where it should go. Shapes are rectangles, rounded rectangles, ellipses, lines and arrows. **Image** and everything in the next section is added in the middle of the slide.
- **Move, resize and rotate**: drag an item to move it, drag a handle to resize it, and drag the dot above it to turn it. Pictures keep their proportions when you drag a corner. Hold **Shift** while resizing to flip that, and while turning to move in 15 degree steps. Guides show when edges and centers line up with other items or the slide margins, and numbers show the space between items. Hold **⌘** to skip snapping. Turn snapping and the grid on or off in the inspector.
- **Edit text**: double-click a text box, or select it and press **Enter**, and the cursor lands where you clicked. Press **Esc** once to step back out to the box, and again to deselect. Drag a text box's border to move it while you type. A text box grows taller as you type, until you drag its height yourself.
- **Move a layout box**: dragging a title, body or image box lifts it off the layout. It keeps its spot if you change layouts. Select it and choose **Snap back to layout** in the inspector to put it back.
- **Select several**: Shift-click items, or drag across empty space. The inspector then offers align, distribute, **Group** and **Duplicate**. A group moves as one item, and **Ungroup** breaks it up.
- **Fine tuning**: the inspector tab for the selected item has X, Y, width, height and rotation, align to the slide, **Bring forward** and **Send back**, and a theme fill for shapes. Arrow keys nudge by 1, and Shift with an arrow nudges by 10.
- **Delete, copy and paste**: Delete removes the selected item. ⌘C, ⌘X and ⌘V copy, cut and paste, also into another deck, and ⌘D duplicates.

### Right-click menus and the format bar

Right-click (or two-finger click) almost anything for the actions that fit it.

- **An item**: **Cut**, **Copy**, **Paste**, **Duplicate**, **Delete**, **Copy style** and **Paste style**, **Arrange** (bring to front, forward, backward, to back), **Align** (to the slide, or to the selection when several are selected), **Group** or **Ungroup**, **Lock** or **Unlock**, **Add build** and **Comment**. Pictures also have **Replace image**, **Crop** and **Reset size**, text boxes have **Add link**, and a layout box you moved has **Snap back to layout**. Right-clicking an item selects it first, and right-clicking inside a selection keeps the whole selection.
- **Empty space on the slide**: **Paste here** puts the copied items at the pointer, **Add text box here**, **Add shape here** and **Add image here**, **Change layout**, **Select all**, **Comment here**, and **Show guides** and **Show grid**.
- **A slide in the list**: **New slide after**, **Duplicate slide**, **Delete slide**, **Skip slide**, **Change layout**, **Copy slide**, **Paste slide** (also into another deck), **Move to top**, **Move to bottom** and **Comment**.
- **Text you are typing in**: the normal text menu stays as it is.

A small bar floats above the selected item with the things you reach for most: text style, bold, italic, underline, link and bullets for text, fill colors for shapes, **Replace image** and **Crop** for pictures. **Arrange** and **More** are always there, and **More** has the same actions as the right-click menu. The bar hides while you drag.

### Shortcuts for moving

- Hold **Option** while you drag to drag a copy and leave the original. Hold **Shift** to keep the drag on one line.
- Hold **Option** while the pointer is over another item to see how far it is from the selected one.
- Hover an item to see its outline.

### Pictures

- **Add**: drop picture files from your computer onto the slide, or paste a picture. It lands where you dropped it. Dropping onto a picture replaces it.
- **Crop**: double-click a picture, drag the handles to show less of it, and press **Esc** or **Done**. **Reset crop** shows the whole picture again. Crops show in the filmstrip, PDF and PowerPoint downloads.

### Lock

**Lock** keeps an item where it is: it can't be dragged, resized, turned, nudged or deleted until you **Unlock** it from the right-click menu or the bar. A small lock shows when you point at it.

### Skip a slide

**Skip slide** keeps a slide in the deck but leaves it out when presenting, for people following along, and in PDF downloads. It shows dimmed in the list with a **Skipped** tag, and it downloads to PowerPoint as a hidden slide. **Unskip slide** brings it back.

### Zoom

Use **⌘+**, **⌘−** and **⌘0** (or pinch on a trackpad, or the zoom control in the corner of the slide) to zoom in and out. **⌘0** fits the slide to the window. When the slide is larger than the window you can scroll around it.

### Select and reorder slides

Click a slide in the list, Shift-click to select a range, and ⌘-click to add or remove one. Drag any selected slide to move all of them together. Slide menu actions apply to everything selected. Moving slides is one step for **Undo**.

Everyone editing the deck sees an item move while you drag it. Each move, resize, rotate, group or insert (a new item, a duplicate, a paste or a new slide) is one step for **Undo**. Undoing an insert removes it, and **Redo** brings it back. Items you add show up in PDF and PowerPoint downloads, in the filmstrip and when presenting, and can have a build step like any other item. Importing a PowerPoint file keeps text boxes, pictures, tables, rectangles, ellipses and lines where they were on the slide.

## Insert tables, charts, icons, emoji, code and video

Everything here is a free item. You can move, resize, rotate, group, copy, comment on and animate it like a text box or shape.

- **Table**: **Insert**, then **Table** adds a table with a header row. Type in the cells. Hover the table's edges to add or remove rows and columns, and open a row or column menu to turn the header row on or off. The table takes the deck's theme.
- **Charts**: choose **Bar chart**, **Line chart** or **Pie chart**. Select the chart and edit its numbers in the inspector. You can change the type, add rows and series, or paste cells copied from a spreadsheet to replace the data. A pie chart uses the first series. Charts use the deck's theme colors.
- **Icon**: opens a searchable list of icons. Select an icon to change it or pick another color in the inspector.
- **Emoji**: adds an emoji as large text. Resize the text box to make it bigger.
- **Code block**: adds a text box with a code block in it. Pick the language from the block's own menu.
- **Video**: paste a YouTube link. The slide shows a video card while you edit. When you present, click the card to play the video on the slide.

## Layouts, backgrounds, sections and the grid

- **Layout gallery**: **New slide** adds a slide with the same layout as the one you are on. Click the arrow next to it to pick from layouts drawn in your deck's theme. **Change layout** (right-click a slide or empty space, or the **Slide** tab) has **Browse layouts** at the top of its list. Changing the layout keeps your content, and items you moved keep their spot.
- **Background**: in the **Slide** tab, choose a theme color or add an image, and pick whether the image fills or fits the slide. Right-click empty space and choose **Background** for the same colors. Backgrounds show in the filmstrip, when presenting, in PDF and in PowerPoint downloads.
- **Sections**: right-click a slide in the filmstrip and choose **Add section here** to start a named section. Click a section's header to collapse it. Right-click the header to rename it, move it up or down with its slides, or remove it. A section moves with its first slide when you drag that slide. PowerPoint downloads keep sections.
- **Grid**: click **Grid** in the toolbar, or press **G**, to see every slide at once. Drag to reorder (the slides you selected move together), double-click a slide to open it, and right-click for the same menu as in the filmstrip.
- **Transitions**: in the **Slide** tab, choose **Dissolve**, **Push** or **Magic Move** for how a slide appears, and click **Preview**. Magic Move glides items that match the slide before it (the same item after **Duplicate slide**, or the same text or picture) and fades the rest. Transitions play when presenting and when following a presenter. They are skipped if your device is set to reduce motion, and builds still run after the transition.

## Save and reuse slides

When the live deck editor is on for you, you can keep decks and single slides for the lab to start from.

- **Save a whole deck**: open the **⋯** menu and choose **Save as template**. Name it and choose who can use it: the whole lab, or, for a deck in a project, that project. The template keeps the deck's theme and every slide, without speaker notes or comments.
- **Save slides to the library**: right-click a slide in the list (or several selected slides) and choose **Save slide to library**.
- **Start a deck from a template**: in [Drive](/drive), click **New** and choose **New deck from template**, then pick a deck.
- **Add saved slides to a deck**: click the arrow beside **New slide** and open the **Library** tab. Click a saved slide or deck to add its slides after the slide you are on. Adding them is one step for **Undo**.
- **Delete a template**: open the **Library** tab and click the bin beside it. Only the person who saved it, or Core, can delete it.

Everyone who can use a scope can use its templates, and anyone who can edit a deck can save it.

## Find and replace

Press **⌘F**, or choose **Find and replace** in the **⋯** menu. It searches the text on every slide and the speaker notes. The arrows step through matches and show each one's slide. **Replace** changes the current match, and **Replace all** changes every match, and one **Undo** puts them all back. Turn on **Match case** to match capital letters exactly.

## Keyboard shortcuts

Press **?**, or choose **Keyboard shortcuts** in the **⋯** menu, to see every shortcut for editing, selecting, arranging and presenting.

## Download as PDF

Open the **⋯** menu and choose **Download PDF** to get every slide as a page, with all builds showing. The **Deck** tab in the inspector has the same button. People who can edit a deck also get **Download PDF with notes**, which adds a page of speaker notes after each slide. Decks over 200 slides can't be exported.

## Comment on a deck

When the live deck editor is on for you, **Comments** in the top bar opens a panel with every comment on the deck, grouped by slide.

- **Comment on a slide**: right-click a slide in the list and choose **Comment on this slide**, or type in the panel.
- **Comment on a spot or a text box**: right-click the slide where you want it and choose **Comment here**, or select a text box and click the comment button at its corner. A dot with your picture marks the spot.
- **Comment on words**: select text in a text box and choose **Add comment**.

Click a comment in the panel to jump to its slide. Replies and @mentions notify people, and the link in the notification opens the slide and the comment. A slide with comments shows a count on its thumbnail. If a slide is deleted, its comments stay under **Deleted slide** until you restore it. You can delete your own comments.

## Work on a deck with an AI assistant

A connected AI assistant outside DALI OS, such as Claude Desktop or Claude Code, can build and edit decks you can edit. See [AI assistants](/help/articles/ai-assistants) to connect one. Ask it to draft a deck from an outline, or to add slides from a document, and it makes the slides with their layouts, text, speaker notes and theme. It can add, move, duplicate and delete slides, change a slide's layout or the deck's theme, and write text, including tables and code. It can also place text boxes, pictures, shapes, charts with their data, icons, videos and polls, then align, group, layer and set build steps for them the way you can in the editor. Ask DALI inside DALI OS can read a deck and answer questions about it, but it does not change decks. Its changes show up live for everyone who has the deck open. It can also give you links to download the deck as a PDF or PowerPoint file. If you can only view a deck, the assistant can read it but not change it.
