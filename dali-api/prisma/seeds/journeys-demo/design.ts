import type { SeedJourney as Journey } from "./types";

const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const DESIGN_POSTER = "/journeys/design-team.jpg";

export const designFoundationsJourney: Journey = {
  id: 'design-foundations',
  title: 'Design foundations',
  description: 'Learn the DALI design language, hand off cleanly to developers, and lead your first partner critique.',
  recommended: true,
  modules: [
  {
    id: 'design-welcome',
    title: 'Welcome to DALI Design',
    summary: 'What designers own on a DALI team and how a term-long project unfolds.',
    slides: [
    {
      id: 'dsw-s1',
      layout: 'title',
      title: 'Design at DALI',
      subtitle: 'You own the experience, end to end'
    },
    {
      id: 'dsw-s2',
      layout: 'split',
      title: 'What you own',
      body: '<ul><li><p>Research synthesis</p></li><li><p>Flows and wireframes</p></li><li><p>Visual design and handoff</p></li><li><p>QA alongside developers</p></li></ul>',
      image: { src: DESIGN_POSTER, alt: 'A designer sketching wireframes on paper' }
    },
    {
      id: 'dsw-s3',
      layout: 'content',
      title: 'Your first two weeks',
      body: '<ol><li><p>Join partner discovery calls with your PM</p></li><li><p>Audit what exists today</p></li><li><p>Share a problem statement with the team</p></li></ol>',
      notes: 'Bring your designer notebook to every discovery call. Second-hand notes lose the details.'
    }],

    duration: '15 min',
    dependsOn: [],
    position: { x: 0, y: 150 },
    pages: [
    {
      id: 'role',
      title: 'The designer on a DALI team',
      content: `<video src="${SAMPLE_VIDEO}" poster="${DESIGN_POSTER}" controls="true" preload="none"></video>
<p><em>How design shapes a DALI project · 5:03</em></p>
<p>You are usually the only designer on your team, so you own the experience end to end: research synthesis, flows, visual design, and making sure what ships matches what was agreed with the partner.</p>`
    },
    {
      id: 'term',
      title: 'How a term unfolds',
      content: `<table><tbody>
<tr><th><p>Weeks</p></th><th><p>Focus</p></th></tr>
<tr><td><p>1–2</p></td><td><p>Discovery with your PM and the partner</p></td></tr>
<tr><td><p>3–5</p></td><td><p>Flows, wireframes, and a first critique</p></td></tr>
<tr><td><p>6–10</p></td><td><p>High fidelity, handoff, and QA alongside devs</p></td></tr>
</tbody></table>`
    }]

  },
  {
    id: 'design-tokens',
    title: 'DALI design tokens',
    summary: 'The shared color, type, and spacing tokens, and how they show up in code.',
    duration: '30 min',
    dependsOn: ['design-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'what-tokens',
      title: 'What tokens are',
      content: `<p>Tokens are named design decisions. Instead of "#FF8B81" scattered across files, everyone uses <code>--dali-coral</code>. Change it once and every button updates.</p>
<pre><code>:root {
  --dali-coral: #FF8B81;
  --dali-teal: #00ADAB;
}

.button { background: var(--dali-coral); }</code></pre>`
    }],

    lab: {
      title: 'Tokenize the palette',
      intro: 'Replace hard-coded colors with DALI tokens so the page can be re-themed in one place.',
      defaultFile: 'styles.css',
      files: {
        'index.html': `<div class="panel">
  <span class="chip">Design</span>
  <h2>Partner critique · Week 4</h2>
  <button class="button">Join session</button>
</div>`,
        'styles.css': `:root {
  /* Add DALI tokens here */
}

body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 40px;
  color: #082330;
}

.panel { background: white; padding: 24px; border-radius: 24px; max-width: 360px; }

.chip {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  background: #00ADAB;
  color: white;
  font-size: 12px;
}

.button {
  border: 0;
  padding: 10px 18px;
  border-radius: 999px;
  background: #FF8B81;
  color: #082330;
  font-weight: 600;
}`
      },
      steps: [
      {
        id: 'coral',
        title: 'Define the coral token',
        instructions: 'Inside `:root`, add `--dali-coral: #FF8B81;`.',
        check: "getComputedStyle(document.documentElement).getPropertyValue('--dali-coral').trim().toLowerCase()==='#ff8b81'"
      },
      {
        id: 'teal',
        title: 'Define the teal token',
        instructions: 'Add `--dali-teal: #00ADAB;` next to it.',
        check: "getComputedStyle(document.documentElement).getPropertyValue('--dali-teal').trim().toLowerCase()==='#00adab'"
      },
      {
        id: 'use',
        title: 'Use the tokens',
        instructions: 'Swap the hard-coded colors in `.button` and `.chip` for `var(--dali-coral)` and `var(--dali-teal)`.',
        check: "(function(){var rules=[];Array.prototype.forEach.call(document.styleSheets,function(s){Array.prototype.forEach.call(s.cssRules,function(r){rules.push(r)})});var b=rules.some(function(r){return r.selectorText==='.button'&&r.cssText.indexOf('var(--dali-coral)')>-1});var c=rules.some(function(r){return r.selectorText==='.chip'&&r.cssText.indexOf('var(--dali-teal)')>-1});return b&&c})()"
      }]

    }
  },
  {
    id: 'figma-handoff',
    title: 'Figma handoff',
    summary: 'Structure files so developers can build from them without a meeting.',
    duration: '20 min',
    dependsOn: ['design-welcome'],
    position: { x: 360, y: 280 },
    pages: [
    {
      id: 'structure',
      title: 'A file developers can trust',
      content: `<ul>
<li><p>One page per flow, frames named after the screen they represent</p></li>
<li><p>Every state designed: empty, loading, error, and success</p></li>
<li><p>Components from the DALI library, not detached copies</p></li>
</ul>
<blockquote><p><strong>Tip:</strong> Mark frames "Ready for dev" only when your PM has signed off. Developers will treat everything else as a draft.</p></blockquote>`
    }]

  },
  {
    id: 'layout-spacing',
    title: 'Layout & spacing',
    summary: 'Grids and spacing scales that keep screens calm and consistent.',
    duration: '30 min',
    dependsOn: ['design-tokens'],
    position: { x: 720, y: 40 },
    pages: [
    {
      id: 'grid',
      title: 'Thinking in grids',
      content: `<p>CSS grid maps directly to the layout grids you set up in Figma. Knowing how it behaves helps you design layouts that survive real content.</p>
<pre><code>.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}</code></pre>`
    }],

    lab: {
      title: 'Lay out a partner dashboard',
      intro: 'Arrange four dashboard tiles on a grid, with the featured tile taking more space.',
      defaultFile: 'styles.css',
      files: {
        'index.html': `<section class="grid">
  <div class="tile featured">Sprint progress</div>
  <div class="tile">Open tickets</div>
  <div class="tile">Hours this week</div>
  <div class="tile">Next demo</div>
</section>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 32px;
  color: #082330;
}

.grid {
  /* Turn this into a 3-column grid */
}

.tile {
  background: white;
  border-radius: 16px;
  padding: 24px;
  min-height: 80px;
}

.featured { background: #ffe7a5; }`
      },
      steps: [
      {
        id: 'grid',
        title: 'Make it a grid',
        instructions: 'Give `.grid` `display: grid` with three equal columns.',
        check: "getComputedStyle(document.querySelector('.grid')).display==='grid'"
      },
      {
        id: 'gap',
        title: 'Add breathing room',
        instructions: 'Use a `gap` of at least `16px` between tiles.',
        check: "parseFloat(getComputedStyle(document.querySelector('.grid')).rowGap)>=16"
      },
      {
        id: 'span',
        title: 'Feature the key tile',
        instructions: 'Make `.featured` span two columns with `grid-column: span 2`.',
        check: "getComputedStyle(document.querySelector('.featured')).gridColumnEnd==='span 2'"
      }]

    }
  },
  {
    id: 'partner-critique',
    title: 'Leading a partner critique',
    summary: 'Run a critique that gets you decisions, not just opinions.',
    duration: '25 min',
    dependsOn: ['layout-spacing', 'figma-handoff'],
    position: { x: 1080, y: 160 },
    pages: [
    {
      id: 'running',
      title: 'Running the session',
      content: `<p>Open with the goal of the screen, not the screen itself. Ask the partner what they expect to happen before you click through.</p>
<ul>
<li><p>Share the one decision you need from them today</p></li>
<li><p>Capture feedback as problems, not solutions</p></li>
<li><p>Close by reading back what you heard and what changes next</p></li>
</ul>`
    }]

  }]

};

export const userResearchJourney: Journey = {
  id: 'user-research',
  title: 'User research',
  description: 'Plan interviews, run usability tests, and turn what you hear into decisions the team can act on.',
  modules: [
  {
    id: 'research-welcome',
    title: 'Why research comes first',
    summary: 'How research de-risks a ten-week project before anyone writes code.',
    duration: '10 min',
    dependsOn: [],
    position: { x: 0, y: 150 },
    pages: [
    {
      id: 'why',
      title: 'Research saves weeks',
      content: `<p>A week of interviews early in the term routinely saves several weeks of rework later. Your job is to find out what is actually true about users before the team commits.</p>`
    }]

  },
  {
    id: 'interview-guide',
    title: 'Writing an interview guide',
    summary: 'Open questions that get stories, not opinions.',
    duration: '20 min',
    dependsOn: ['research-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'questions',
      title: 'Ask about the past, not the future',
      content: `<ul>
<li><p>"Tell me about the last time you…" beats "Would you use…"</p></li>
<li><p>Follow up with "why" more than feels natural</p></li>
<li><p>Leave silence. People fill it with the good stuff</p></li>
</ul>`
    }]

  },
  {
    id: 'usability-testing',
    title: 'Running usability tests',
    summary: 'Watch people use your prototype without helping them.',
    duration: '25 min',
    dependsOn: ['research-welcome'],
    position: { x: 360, y: 280 },
    pages: [
    {
      id: 'tasks',
      title: 'Write tasks, not instructions',
      content: `<blockquote><p><strong>Tip:</strong> Say "Log the hours you worked yesterday", not "Click the Add entry button".</p></blockquote>`
    }]

  },
  {
    id: 'synthesis',
    title: 'Synthesizing findings',
    summary: 'Cluster notes into patterns the team can act on.',
    duration: '25 min',
    dependsOn: ['interview-guide'],
    position: { x: 720, y: 40 },
    pages: [
    {
      id: 'affinity',
      title: 'From sticky notes to insights',
      content: `<p>Write one observation per note, group them silently with your team, then name each group as a finding in a full sentence.</p>`
    }]

  },
  {
    id: 'research-readout',
    title: 'Sharing a readout',
    summary: 'Present findings to your team and partner in under fifteen minutes.',
    duration: '15 min',
    dependsOn: ['synthesis', 'usability-testing'],
    position: { x: 1080, y: 160 },
    pages: [
    {
      id: 'readout',
      title: 'Lead with decisions',
      content: `<ol>
<li><p>Three findings, each with a quote</p></li>
<li><p>What we will change because of them</p></li>
<li><p>Open questions for next round</p></li>
</ol>`
    }]

  }]

};