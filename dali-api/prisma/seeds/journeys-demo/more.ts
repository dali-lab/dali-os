import type { SeedJourney as Journey } from "./types";

const DEV_POSTER = "/journeys/dev-team.jpg";
const DESIGN_POSTER = "/journeys/design-team.jpg";
const PRODUCT_POSTER = "/journeys/product-team.jpg";

// ─── Engineering ─────────────────────────────────────────────────────────────

export const testingReviewJourney: Journey = {
  id: "testing-review",
  title: "Testing and code review",
  description: "Write tests your teammates trust, and give reviews that make code better without slowing anyone down.",
  modules: [
    {
      id: "tr-why",
      title: "Why we test",
      summary: "What tests buy a short-lived partner project, and what they don't.",
      duration: "15 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "tr-why-1",
          title: "Tests are for the next person",
          content: `<p>DALI projects change hands every term. The developer who reads your code next probably wasn't in the room when you wrote it. A test is the fastest way to tell them what the code is supposed to do.</p>
<h3>What to test first</h3>
<ul><li><p>Logic with rules: pricing, permissions, date math</p></li><li><p>Bugs you already fixed, so they stay fixed</p></li><li><p>Anything a partner would notice if it broke</p></li></ul>
<blockquote><p><strong>Rule of thumb:</strong> if you had to think hard to write it, write a test for it.</p></blockquote>`,
        },
      ],
      slides: [
        { id: "tr-s1", layout: "title", title: "Why we test", subtitle: "Writing for the developer who comes after you" },
        { id: "tr-s2", layout: "content", title: "Good tests are", body: "<ul><li><p>Fast to run</p></li><li><p>Named after the behavior</p></li><li><p>Independent of each other</p></li></ul>" },
      ],
    },
    {
      id: "tr-unit",
      title: "Your first unit tests",
      summary: "Arrange, act, assert, and naming tests after behavior.",
      duration: "35 min",
      dependsOn: ["tr-why"],
      position: { x: 360, y: 60 },
      pages: [
        {
          id: "tr-unit-1",
          title: "Arrange, act, assert",
          content: `<p>Every test does three things: sets up the world, runs the code, and checks the result.</p>
<pre><code>it("rounds a total to cents", () =&gt; {
  const items = [{ price: 1.005 }, { price: 2 }];   // arrange
  const total = cartTotal(items);                    // act
  expect(total).toBe(3.01);                          // assert
});</code></pre>
<p>Name the test after the behavior, not the function. "rounds a total to cents" still makes sense after the function is renamed.</p>`,
        },
      ],
      lab: {
        title: "Make the tests pass",
        intro: "The page runs a tiny test suite against `cartTotal`. Fix the function until every test passes.",
        defaultFile: "cart.js",
        files: {
          "index.html": `<main>
  <h1>Cart tests</h1>
  <ul id="results"></ul>
</main>`,
          "cart.js": `function cartTotal(items) {
  let total = 0;
  for (const item of items) total += item.price;
  return total;
}
`,
          "tests.js": `const tests = [
  ["adds prices", () => cartTotal([{ price: 1 }, { price: 2 }]) === 3],
  ["handles quantity", () => cartTotal([{ price: 2, qty: 3 }]) === 6],
  ["rounds to cents", () => cartTotal([{ price: 0.1 }, { price: 0.2 }]) === 0.3],
];
const list = document.querySelector("#results");
for (const [name, fn] of tests) {
  const li = document.createElement("li");
  let ok = false;
  try { ok = fn(); } catch (e) { console.error(e); }
  li.textContent = (ok ? "PASS " : "FAIL ") + name;
  li.dataset.pass = String(ok);
  list.append(li);
}
`,
        },
        steps: [
          {
            id: "tr-qty",
            title: "Respect quantity",
            instructions: "Items can have a `qty`. Multiply the price by it, and treat a missing `qty` as 1.",
            hint: "Try `item.price * (item.qty ?? 1)`.",
            check: "typeof cartTotal === 'function' && cartTotal([{ price: 2, qty: 3 }]) === 6",
          },
          {
            id: "tr-round",
            title: "Round to cents",
            instructions: "Floating point makes `0.1 + 0.2` come out as `0.30000000000000004`. Round the total to two decimals.",
            hint: "`Math.round(total * 100) / 100`",
            check: "typeof cartTotal === 'function' && cartTotal([{ price: 0.1 }, { price: 0.2 }]) === 0.3",
          },
          {
            id: "tr-all",
            title: "Every test passes",
            instructions: "Check the page: every line should start with PASS.",
            check: "document.querySelectorAll('[data-pass=\"false\"]').length === 0 && document.querySelectorAll('[data-pass=\"true\"]').length === 3",
          },
        ],
      },
    },
    {
      id: "tr-review",
      title: "Giving a good review",
      summary: "Comment on the code, not the coder, and say how much each comment matters.",
      duration: "20 min",
      dependsOn: ["tr-why"],
      position: { x: 360, y: 260 },
      pages: [
        {
          id: "tr-review-1",
          title: "Label your comments",
          content: `<p>Not every comment blocks a merge. Say which ones do.</p>
<table><tbody><tr><th><p>Prefix</p></th><th><p>Means</p></th></tr><tr><td><p><strong>blocking:</strong></p></td><td><p>Must change before merge</p></td></tr><tr><td><p><strong>suggestion:</strong></p></td><td><p>Worth doing, your call</p></td></tr><tr><td><p><strong>nit:</strong></p></td><td><p>Style or taste, fine to skip</p></td></tr></tbody></table>
<p>Ask questions instead of giving orders: "What happens if the list is empty?" teaches more than "Handle the empty case."</p>`,
        },
      ],
      quiz: {
        title: "Review etiquette",
        intro: "",
        passingScore: 75,
        questions: [
          {
            id: "tr-q1",
            type: "multiple-choice",
            prompt: "A teammate named a variable `data2`. You'd prefer `invoices`. How do you label that comment?",
            options: [
              { id: "tr-q1-a", text: "blocking:" },
              { id: "tr-q1-b", text: "nit:" },
              { id: "tr-q1-c", text: "Don't comment, just fix it after merge" },
            ],
            correctOptionId: "tr-q1-b",
            explanation: "Naming taste rarely blocks a merge. Mark it so the author can decide.",
          },
          {
            id: "tr-q2",
            type: "multiple-choice",
            prompt: "The PR deletes a permission check on an admin route. What do you do?",
            options: [
              { id: "tr-q2-a", text: "Leave a blocking comment and request changes" },
              { id: "tr-q2-b", text: "Approve, they probably meant to" },
              { id: "tr-q2-c", text: "Leave a nit" },
            ],
            correctOptionId: "tr-q2-a",
          },
          {
            id: "tr-q3",
            type: "short-answer",
            prompt: "In one word: what should a test be named after, the function or the behavior?",
            acceptedAnswers: ["behavior", "behaviour", "the behavior"],
          },
          {
            id: "tr-q4",
            type: "short-answer",
            prompt: "Describe one review comment you received that made your code better.",
            acceptedAnswers: [],
          },
        ],
      },
    },
    {
      id: "tr-ci",
      title: "When CI is red",
      summary: "Read the failing check, reproduce it locally, and fix the cause.",
      duration: "15 min",
      dependsOn: ["tr-unit", "tr-review"],
      position: { x: 720, y: 160 },
      pages: [
        {
          id: "tr-ci-1",
          title: "Read before you rerun",
          content: `<ol><li><p>Open the failing job and scroll to the first error, not the last.</p></li><li><p>Run the same command locally.</p></li><li><p>Fix the cause. Rerunning a flaky test without a note just hides it from the next person.</p></li></ol>
<pre><code>npm test -- cart.test.ts</code></pre>`,
        },
      ],
    },
  ],
};

export const accessibleWebJourney: Journey = {
  id: "accessible-web",
  title: "Building accessible web apps",
  description: "Make what you ship usable with a keyboard, a screen reader, and low vision. Most fixes are one line.",
  modules: [
    {
      id: "aw-intro",
      title: "Who we're building for",
      summary: "Accessibility is part of done, not a later pass.",
      duration: "10 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "aw-intro-1",
          title: "Part of done",
          content: `<video src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" poster="${DEV_POSTER}" controls="true" preload="none"></video>
<p>Many DALI partners serve the public, and many are required to meet accessibility standards. Fixing it during the sprint costs minutes. Fixing it after launch costs a rewrite.</p>
<ul><li><p>Everything works with the keyboard alone</p></li><li><p>Every image and control has a text name</p></li><li><p>Text has enough contrast to read</p></li></ul>`,
        },
      ],
    },
    {
      id: "aw-semantic",
      title: "Semantic HTML and labels",
      summary: "Use the element that already does the job.",
      duration: "30 min",
      dependsOn: ["aw-intro"],
      position: { x: 360, y: 150 },
      pages: [
        {
          id: "aw-semantic-1",
          title: "Buttons are buttons",
          content: `<p>A <code>&lt;div onclick&gt;</code> looks like a button but can't be focused or pressed with Enter. A <code>&lt;button&gt;</code> gets all of that for free.</p>
<p>Every input needs a label the screen reader can announce:</p>
<pre><code>&lt;label for="email"&gt;Email&lt;/label&gt;
&lt;input id="email" type="email" /&gt;</code></pre>`,
        },
      ],
      lab: {
        title: "Fix the signup form",
        intro: "This form looks fine and is unusable without a mouse. Fix it so every check passes.",
        defaultFile: "index.html",
        files: {
          "index.html": `<main>
  <h1>Join the newsletter</h1>
  <img src="https://picsum.photos/seed/dali/320/120" />
  <div>
    <span>Email</span>
    <input id="email" type="email" />
  </div>
  <div class="btn" onclick="submitForm()">Sign up</div>
</main>`,
          "styles.css": `body { font-family: system-ui, sans-serif; padding: 24px; color: #082330; }
.btn, button { display: inline-block; margin-top: 12px; padding: 10px 18px; border-radius: 999px; background: #ff8b81; border: 0; font-weight: 600; cursor: pointer; }`,
          "script.js": `function submitForm() {
  console.log("Submitted", document.querySelector("#email").value);
}
`,
        },
        steps: [
          {
            id: "aw-alt",
            title: "Describe the image",
            instructions: "Give the `img` an `alt` that says what it shows, or `alt=\"\"` if it's decoration.",
            check: "document.querySelector('img')?.hasAttribute('alt')",
          },
          {
            id: "aw-label",
            title: "Label the email field",
            instructions: "Swap the `span` for a `label` with `for=\"email\"`.",
            hint: "`<label for=\"email\">Email</label>`",
            check: "document.querySelector('label[for=\"email\"]') !== null",
          },
          {
            id: "aw-button",
            title: "Use a real button",
            instructions: "Replace the clickable `div` with a `<button>` that still calls `submitForm()`.",
            check: "Array.from(document.querySelectorAll('button')).some((b) => /sign up/i.test(b.textContent))",
          },
        ],
      },
    },
    {
      id: "aw-keyboard",
      title: "Keyboard and focus",
      summary: "Tab through your feature before you open the PR.",
      duration: "20 min",
      dependsOn: ["aw-semantic"],
      position: { x: 720, y: 150 },
      pages: [
        {
          id: "aw-keyboard-1",
          title: "The tab test",
          content: `<p>Put your mouse away and press Tab through the page.</p>
<ul><li><p>Can you see where focus is at every step?</p></li><li><p>Does the order match the visual order?</p></li><li><p>Can you open, use and close every dialog and menu?</p></li></ul>
<blockquote><p>Never remove the focus outline without replacing it with something just as visible.</p></blockquote>`,
        },
      ],
      quiz: {
        title: "Accessibility check",
        intro: "",
        passingScore: 100,
        questions: [
          {
            id: "aw-q1",
            type: "multiple-choice",
            prompt: "Which element should a clickable action use?",
            options: [
              { id: "aw-q1-a", text: "<div onclick>" },
              { id: "aw-q1-b", text: "<button>" },
              { id: "aw-q1-c", text: "<span tabindex=\"0\">" },
            ],
            correctOptionId: "aw-q1-b",
          },
          {
            id: "aw-q2",
            type: "multiple-choice",
            prompt: "An image is purely decorative. What alt text should it have?",
            options: [
              { id: "aw-q2-a", text: "No alt attribute" },
              { id: "aw-q2-b", text: "alt=\"image\"" },
              { id: "aw-q2-c", text: "alt=\"\"" },
            ],
            correctOptionId: "aw-q2-c",
            explanation: "An empty alt tells screen readers to skip it. A missing alt makes them read the file name.",
          },
        ],
      },
    },
  ],
};

// ─── Design ──────────────────────────────────────────────────────────────────

export const prototypingJourney: Journey = {
  id: "figma-prototyping",
  title: "Prototyping in Figma",
  description: "Go from sketch to clickable prototype, organize files so developers can find things, and test with real people.",
  modules: [
    {
      id: "fp-files",
      title: "Setting up a project file",
      summary: "Pages, frames and naming that the whole team can navigate.",
      duration: "15 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "fp-files-1",
          title: "One file per project",
          content: `<p>Every DALI project gets one Figma file in the team space, with the same pages in the same order:</p>
<ol><li><p><strong>Cover</strong>: project name, term, status</p></li><li><p><strong>Research</strong>: notes, journey maps</p></li><li><p><strong>Explorations</strong>: anything goes</p></li><li><p><strong>Ready for dev</strong>: only final screens</p></li></ol>
<p>Name frames after the screen and state, like <code>Checkout / Empty cart</code>.</p>`,
        },
      ],
      slides: [
        { id: "fp-s1", layout: "title", title: "Prototyping in Figma", subtitle: "From sketch to something people can click" },
        { id: "fp-s2", layout: "split", title: "Keep explorations messy", body: "<ul><li><p>Explore wide on Explorations</p></li><li><p>Move only final screens to Ready for dev</p></li></ul>", image: { src: DESIGN_POSTER, alt: "Designers comparing printed wireframes" } },
      ],
    },
    {
      id: "fp-components",
      title: "Components and variants",
      summary: "Build a button once and use it everywhere.",
      duration: "30 min",
      dependsOn: ["fp-files"],
      position: { x: 360, y: 60 },
      pages: [
        {
          id: "fp-components-1",
          title: "Variants over copies",
          content: `<p>When you copy a button and tweak it, the copies drift. A component with variants keeps every state in one place.</p>
<ul><li><p><strong>Properties</strong>: size, style, state</p></li><li><p><strong>States</strong>: default, hover, pressed, disabled</p></li></ul>
<p>Developers map variants straight to component props, so name them the way code would.</p>`,
        },
      ],
    },
    {
      id: "fp-flows",
      title: "Clickable flows",
      summary: "Wire screens together so testers can try the real path.",
      duration: "25 min",
      dependsOn: ["fp-files"],
      position: { x: 360, y: 260 },
      pages: [
        {
          id: "fp-flows-1",
          title: "Prototype the main path first",
          content: `<p>Wire the one path that matters most, start to finish, before the edge cases. A tester who gets stuck on a dead link learns nothing about your design.</p>`,
        },
      ],
    },
    {
      id: "fp-testing",
      title: "Usability testing",
      summary: "Five testers, a task list, and not helping.",
      duration: "30 min",
      dependsOn: ["fp-components", "fp-flows"],
      position: { x: 720, y: 160 },
      pages: [
        {
          id: "fp-testing-1",
          title: "Running a session",
          content: `<ol><li><p>Give a task, not instructions: "Find a volunteer shift for Saturday."</p></li><li><p>Ask them to think out loud.</p></li><li><p>Don't help. Silence is data.</p></li><li><p>Write down where they hesitated, not what they said they liked.</p></li></ol>`,
        },
      ],
      quiz: {
        title: "Testing basics",
        intro: "",
        passingScore: 80,
        questions: [
          {
            id: "fp-q1",
            type: "multiple-choice",
            prompt: "A tester is stuck for 20 seconds. What do you do?",
            options: [
              { id: "fp-q1-a", text: "Point to the right button" },
              { id: "fp-q1-b", text: "Wait, and ask what they're looking for" },
              { id: "fp-q1-c", text: "End the session" },
            ],
            correctOptionId: "fp-q1-b",
          },
          {
            id: "fp-q2",
            type: "short-answer",
            prompt: "Roughly how many testers find most usability problems in one round?",
            acceptedAnswers: ["5", "five"],
            explanation: "Five testers usually surface most of the big problems. Fix them, then test again.",
          },
        ],
      },
    },
  ],
};

export const designSystemsJourney: Journey = {
  id: "design-systems",
  title: "Design systems and handoff",
  description: "Color, type and spacing tokens that survive handoff, and specs developers can build from without guessing.",
  modules: [
    {
      id: "ds-tokens",
      title: "Tokens",
      summary: "Name colors and sizes by role so themes and code stay in sync.",
      duration: "20 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "ds-tokens-1",
          title: "Name by role, not value",
          content: `<p><code>text-muted</code> survives a rebrand. <code>gray-500</code> doesn't. Name tokens after what they're for.</p>
<table><tbody><tr><th><p>Token</p></th><th><p>Used for</p></th></tr><tr><td><p>surface</p></td><td><p>Cards and panels</p></td></tr><tr><td><p>accent</p></td><td><p>The one primary action</p></td></tr><tr><td><p>danger</p></td><td><p>Destructive actions and errors</p></td></tr></tbody></table>`,
        },
      ],
      lab: {
        title: "Theme with variables",
        intro: "The card uses hard-coded colors. Move them into CSS variables so a dark theme is one class away.",
        defaultFile: "styles.css",
        files: {
          "index.html": `<main class="card">
  <h1>Volunteer shifts</h1>
  <p>Three spots left this Saturday.</p>
  <button>Sign up</button>
</main>`,
          "styles.css": `body { font-family: system-ui, sans-serif; padding: 32px; background: #f1f3f4; }
.card { background: white; color: #082330; padding: 24px; border-radius: 24px; }
button { background: #ff8b81; border: 0; padding: 10px 18px; border-radius: 999px; }
`,
        },
        steps: [
          {
            id: "ds-vars",
            title: "Define tokens on :root",
            instructions: "Add `--surface`, `--text` and `--accent` on `:root`.",
            check: "['--surface','--text','--accent'].every((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() !== '')",
          },
          {
            id: "ds-use",
            title: "Use them",
            instructions: "Make the card background `var(--surface)` and the button `var(--accent)`.",
            hint: "`background: var(--surface);`",
            check: "Array.from(document.styleSheets).some((s) => Array.from(s.cssRules).some((r) => /var\\(--surface\\)/.test(r.cssText)))",
          },
        ],
      },
    },
    {
      id: "ds-handoff",
      title: "Handoff that sticks",
      summary: "Specs, states and the questions developers will ask anyway.",
      duration: "25 min",
      dependsOn: ["ds-tokens"],
      position: { x: 360, y: 150 },
      pages: [
        {
          id: "ds-handoff-1",
          title: "A handoff checklist",
          content: `<ul><li><p>Empty, loading and error states for every screen</p></li><li><p>What happens with very long text</p></li><li><p>Mobile and desktop widths</p></li><li><p>Tokens, not hex values, in every spec</p></li></ul>
<blockquote><p>Walk through the file with your developers live. A 20 minute call saves a week of messages.</p></blockquote>`,
        },
      ],
      quiz: {
        title: "Handoff",
        intro: "",
        passingScore: 100,
        questions: [
          {
            id: "ds-q1",
            type: "multiple-choice",
            prompt: "Which token name will survive a rebrand?",
            options: [
              { id: "ds-q1-a", text: "coral-400" },
              { id: "ds-q1-b", text: "accent" },
              { id: "ds-q1-c", text: "#FF8B81" },
            ],
            correctOptionId: "ds-q1-b",
          },
        ],
      },
    },
  ],
};

// ─── Product ─────────────────────────────────────────────────────────────────

export const ticketsJourney: Journey = {
  id: "writing-tickets",
  title: "Writing tickets that ship",
  description: "Turn partner requests into small, testable tickets your team can pick up without a meeting.",
  modules: [
    {
      id: "wt-anatomy",
      title: "Anatomy of a ticket",
      summary: "The why, the what, and how you'll know it's done.",
      duration: "15 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "wt-anatomy-1",
          title: "Three parts",
          content: `<p><strong>Context</strong>: who needs this and why. <strong>Scope</strong>: what's in and what isn't. <strong>Acceptance criteria</strong>: the checks a reviewer runs.</p>
<pre><code>As a volunteer coordinator
I want to see unfilled shifts first
So I can fill gaps before the weekend

Done when:
- Unfilled shifts sort to the top
- A badge shows how many spots are open</code></pre>`,
        },
      ],
      slides: [
        { id: "wt-s1", layout: "title", title: "Writing tickets that ship", subtitle: "Small, clear, testable" },
        { id: "wt-s2", layout: "image", title: "A good ticket answers the questions before they're asked", image: { src: PRODUCT_POSTER, alt: "A PM and developer reviewing a board of tickets" } },
      ],
    },
    {
      id: "wt-sizing",
      title: "Slicing and sizing",
      summary: "Split work so each ticket ships something on its own.",
      duration: "20 min",
      dependsOn: ["wt-anatomy"],
      position: { x: 360, y: 150 },
      pages: [
        {
          id: "wt-sizing-1",
          title: "Slice vertically",
          content: `<p>"Build the API" and "Build the UI" ship nothing on their own. "Show unfilled shifts first" ships a small piece of everything.</p>
<p>If a ticket takes more than three days, split it again.</p>`,
        },
      ],
      quiz: {
        title: "Ticket check",
        intro: "Pick the better ticket.",
        passingScore: 50,
        questions: [
          {
            id: "wt-q1",
            type: "multiple-choice",
            prompt: "Which ticket is ready to start?",
            options: [
              { id: "wt-q1-a", text: "Improve the dashboard" },
              { id: "wt-q1-b", text: "Sort unfilled shifts to the top of the dashboard, with an open-spots badge" },
            ],
            correctOptionId: "wt-q1-b",
          },
          {
            id: "wt-q2",
            type: "multiple-choice",
            prompt: "A ticket is estimated at two weeks. What do you do?",
            options: [
              { id: "wt-q2-a", text: "Split it into slices that each ship something" },
              { id: "wt-q2-b", text: "Assign it to two developers" },
            ],
            correctOptionId: "wt-q2-a",
          },
        ],
      },
    },
    {
      id: "wt-grooming",
      title: "Backlog grooming",
      summary: "A weekly half hour that keeps sprint planning short.",
      duration: "15 min",
      dependsOn: ["wt-sizing"],
      position: { x: 720, y: 150 },
      pages: [
        {
          id: "wt-grooming-1",
          title: "Keep the top ten ready",
          content: `<p>You don't need a perfect backlog. You need the next ten tickets to be clear enough that anyone could start one tomorrow.</p>`,
        },
      ],
    },
  ],
};

export const demoDayJourney: Journey = {
  id: "demo-day",
  title: "Running a term demo",
  description: "Plan, rehearse and run the end-of-term demo for your partner, then hand the project off cleanly.",
  modules: [
    {
      id: "dd-plan",
      title: "Plan the story",
      summary: "Show the problem you solved, not every feature you built.",
      duration: "20 min",
      dependsOn: [],
      position: { x: 0, y: 150 },
      pages: [
        {
          id: "dd-plan-1",
          title: "Problem, demo, next",
          content: `<ol><li><p><strong>The problem</strong> in the partner's words, one minute</p></li><li><p><strong>The demo</strong> of the main path, live, five minutes</p></li><li><p><strong>What's next</strong> and what you need from them, two minutes</p></li></ol>`,
        },
      ],
    },
    {
      id: "dd-rehearse",
      title: "Rehearse",
      summary: "Run it twice with the team, once with a stranger.",
      duration: "15 min",
      dependsOn: ["dd-plan"],
      position: { x: 360, y: 60 },
      pages: [
        {
          id: "dd-rehearse-1",
          title: "Have a backup",
          content: `<p>Record a video of the demo the day before. If the Wi-Fi or the staging server fails, you play the video and keep going.</p>`,
        },
      ],
    },
    {
      id: "dd-handoff",
      title: "Hand off the project",
      summary: "Docs, access and a README the next team will thank you for.",
      duration: "25 min",
      dependsOn: ["dd-plan"],
      position: { x: 360, y: 260 },
      pages: [
        {
          id: "dd-handoff-1",
          title: "The handoff checklist",
          content: `<ul><li><p>README: how to run it, deploy it, and where secrets live</p></li><li><p>Partner has admin access to everything they pay for</p></li><li><p>Open issues are triaged and labeled</p></li><li><p>A short note on what you'd do next</p></li></ul>`,
        },
      ],
      quiz: {
        title: "Ready to hand off?",
        intro: "",
        passingScore: 100,
        questions: [
          {
            id: "dd-q1",
            type: "short-answer",
            prompt: "What's one thing the next team should find in the README?",
            acceptedAnswers: [],
          },
        ],
      },
    },
  ],
};
