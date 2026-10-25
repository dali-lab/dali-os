import type { SeedStudioLab as StudioLab } from "./types";

const TRAIL_FINDER_SCREEN = "/journeys/trail-finder.jpg";

/** Design · Leading a partner critique — whiteboard with hidden problem areas. */
export const trailFinderCritique: StudioLab = {
  kind: 'canvas',
  title: 'Critique the Trail Finder home screen',
  brief: `The Outing Club's current Trail Finder app is hard to use. Before your critique session with them, find what's wrong with the home screen.

Drop a comment pin on each usability problem and say which principle it breaks (contrast, labels, hierarchy, consistency, tap targets).

Then add sticky notes with your redesign ideas next to the screen.`,
  criteria: [
  {
    id: 'tf-c1',
    label: 'Pin at least 4 of the 6 usability problems',
    description: 'Place a comment pin directly on each problem.',
    mode: 'auto',
    rule: { kind: 'hotspots', min: 4 }
  },
  {
    id: 'tf-c2',
    label: 'Add 3 redesign ideas as sticky notes',
    mode: 'auto',
    rule: { kind: 'item-count', itemType: 'sticky', min: 3 }
  },
  {
    id: 'tf-c3',
    label: 'Every pin names the principle it breaks',
    description: 'For example: “Contrast: the title is pale gray on white.”',
    mode: 'self'
  },
  {
    id: 'tf-c4',
    label: 'Ideas are specific enough to hand to a developer',
    description: 'A design lead checks that each idea describes a concrete change.',
    mode: 'mentor'
  }],

  canvas: {
    items: [
    { id: 'tf-screen', type: 'image', x: 0, y: 0, width: 360, height: 645, src: TRAIL_FINDER_SCREEN, alt: 'Trail Finder app home screen', locked: true },
    { id: 'tf-label', type: 'text', x: 0, y: -56, text: 'Trail Finder · Home', locked: true },
    {
      id: 'tf-howto',
      type: 'sticky',
      x: 420,
      y: 0,
      width: 220,
      height: 180,
      color: 'blue',
      text: 'Use the pin tool (P) to mark problems on the screen. Put your redesign ideas on yellow stickies over here →',
      locked: true
    }],

    hotspots: [
    { id: 'tf-h1', label: 'Low-contrast title', x: 0, y: 0, width: 360, height: 54 },
    { id: 'tf-h2', label: 'Search has no label', x: 0, y: 54, width: 360, height: 46 },
    { id: 'tf-h3', label: 'Text over a busy photo', x: 0, y: 100, width: 360, height: 176 },
    { id: 'tf-h4', label: 'Wall of text', x: 0, y: 276, width: 360, height: 232 },
    { id: 'tf-h5', label: 'Inconsistent buttons', x: 0, y: 508, width: 360, height: 70 },
    { id: 'tf-h6', label: 'Unlabeled tiny nav icons', x: 0, y: 578, width: 360, height: 67 }]

  }
};

/** Design · Synthesis — FigJam-style affinity map with movable starter notes. */
export const affinityMap: StudioLab = {
  kind: 'canvas',
  title: 'Affinity map five interview notes',
  brief: `These notes come from interviews with Lab Inventory users at Thayer. Drag them into groups that share a theme.

Name each group with a text label (T), then write at least two insights on pink stickies: what the group tells you about users' needs.`,
  criteria: [
  { id: 'af-c1', label: 'Name at least 3 groups with text labels', mode: 'auto', rule: { kind: 'item-count', itemType: 'text', min: 3 } },
  { id: 'af-c2', label: 'Write 2 insights on pink stickies', mode: 'auto', rule: { kind: 'item-count', itemType: 'sticky', color: 'pink', min: 2 } },
  { id: 'af-c3', label: 'Each insight is a need, not a feature request', mode: 'self' }],

  canvas: {
    items: [
    { id: 'af-n1', type: 'sticky', x: 0, y: 0, width: 170, height: 170, color: 'yellow', text: '"I never know if the oscilloscope is free until I walk over."' },
    { id: 'af-n2', type: 'sticky', x: 200, y: 0, width: 170, height: 170, color: 'yellow', text: '"The sign-out sheet is always missing a page."' },
    { id: 'af-n3', type: 'sticky', x: 400, y: 0, width: 170, height: 170, color: 'yellow', text: '"I book stuff on my phone between classes."' },
    { id: 'af-n4', type: 'sticky', x: 600, y: 0, width: 170, height: 170, color: 'yellow', text: '"Nobody returns the soldering kits on time."' },
    { id: 'af-n5', type: 'sticky', x: 0, y: 200, width: 170, height: 170, color: 'yellow', text: '"I wish it told me when my reservation is about to start."' },
    { id: 'af-n6', type: 'sticky', x: 200, y: 200, width: 170, height: 170, color: 'yellow', text: '"Staff have to chase people over email for late returns."' },
    { id: 'af-n7', type: 'sticky', x: 400, y: 200, width: 170, height: 170, color: 'yellow', text: '"I walked 15 minutes to find the 3D printer was broken."' },
    { id: 'af-n8', type: 'sticky', x: 600, y: 200, width: 170, height: 170, color: 'yellow', text: '"Paper forms get lost and nobody knows who had it last."' }],

    hotspots: []
  }
};

/** Product · Writing tickets — document with a ticket template. */
export const labInventoryTicket: StudioLab = {
  kind: 'document',
  title: 'Write the first Lab Inventory ticket',
  brief: `Thayer wants students to reserve lab equipment from their phones instead of the paper sign-out sheet.

Write the ticket for the very first slice: a student can see whether an item is available right now. A developer should be able to pick it up without asking you a follow-up question.`,
  criteria: [
  { id: 'tk-c1', label: 'Explain why in at least 15 words', mode: 'auto', rule: { kind: 'section', heading: 'Why', minWords: 15 } },
  { id: 'tk-c2', label: 'List 2 or more “Done when” criteria', mode: 'auto', rule: { kind: 'list-items', heading: 'Done when', min: 2 } },
  { id: 'tk-c3', label: 'Say what is out of scope', mode: 'auto', rule: { kind: 'section', heading: 'Out of scope', minWords: 3 } },
  {
    id: 'tk-c4',
    label: 'Each “Done when” item can be tested with yes or no',
    description: 'Re-read each one and ask: could QA say pass or fail without asking you?',
    mode: 'self'
  },
  { id: 'tk-c5', label: 'Scope fits in a single sprint', description: 'A product lead checks the slice is small enough.', mode: 'mentor' }],

  document: {
    template: `<h3>Title</h3><p></p><h3>Why</h3><p></p><h3>Done when</h3><ul><li><p></p></li></ul><h3>Out of scope</h3><p></p><h3>Design</h3><p></p>`
  }
};