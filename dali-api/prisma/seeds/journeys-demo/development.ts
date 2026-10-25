import type { SeedJourney as Journey } from "./types";

// Swap the sample video src for real DALI recordings when they're hosted.
const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const DEV_POSTER = "/journeys/dev-team.jpg";

export const webFoundationsJourney: Journey = {
  id: 'web-foundations',
  title: 'Web foundations',
  description: 'From your first line of code at DALI to shipping a ticket on a partner project.',
  recommended: true,
  modules: [
  {
    id: 'dev-welcome',
    title: 'Welcome to DALI Dev',
    summary: 'How dev teams work at DALI, the tools you will use every day, and your first tiny web page.',
    duration: '20 min',
    dependsOn: [],
    position: { x: 0, y: 170 },
    slides: [
    {
      id: 'dw-s1',
      layout: 'title',
      title: 'Welcome to DALI Dev',
      subtitle: 'What your first term on a dev team looks like',
      notes: 'Click through these before the lesson pages, or present them at your team kickoff.'
    },
    {
      id: 'dw-s2',
      layout: 'content',
      title: 'How a term runs',
      body: '<ul><li><p><strong>Weeks 1–2</strong> · Partner kickoff and dev setup</p></li><li><p><strong>Weeks 3–8</strong> · Two-week sprints with a demo each</p></li><li><p><strong>Weeks 9–10</strong> · Polish, QA, and handoff</p></li></ul>'
    },
    {
      id: 'dw-s3',
      layout: 'split',
      title: 'Your team',
      body: '<ul><li><p>2–4 developers</p></li><li><p>A designer and a PM</p></li><li><p>A dev mentor checking in weekly</p></li></ul>',
      image: { src: DEV_POSTER, alt: 'A DALI dev team working together at a shared desk' },
      notes: 'Your mentor is the person to ask when you are blocked for more than an hour.'
    },
    {
      id: 'dw-s4',
      layout: 'content',
      title: "Tools you'll use every day",
      body: '<ul><li><p>React + TypeScript for most partner apps</p></li><li><p>GitHub for code, reviews, and tickets</p></li><li><p>Figma for designs and handoff</p></li></ul><pre><code>npm install &amp;&amp; npm run dev</code></pre>'
    },
    {
      id: 'dw-s5',
      layout: 'image',
      title: 'Every term ends with a demo for the partner',
      image: { src: DEV_POSTER, alt: 'Developers presenting their project on a large screen' }
    }],

    pages: [
    {
      id: 'how-we-work',
      title: 'How dev teams work here',
      content: `<video src="${SAMPLE_VIDEO}" poster="${DEV_POSTER}" controls="true" preload="none"></video>
<p><em>A day on a DALI dev team · 4:12</em></p>
<p>Every term, DALI staffs small cross-functional teams on real partner projects. A typical team has two to four developers, a designer, and a PM, with a dev mentor checking in weekly.</p>
<h3>What you will own</h3>
<ul>
<li><p>Tickets scoped by your PM, usually one to three days of work each</p></li>
<li><p>Code reviews for your teammates, not just your own pull requests</p></li>
<li><p>Demoing what you shipped at the end-of-sprint partner check-in</p></li>
</ul>`
    },
    {
      id: 'your-toolkit',
      title: 'Your toolkit',
      content: `<p>Most DALI projects are web apps built with React and TypeScript. Before you touch a partner codebase, the labs in this journey get you comfortable with the fundamentals underneath.</p>
<blockquote><p><strong>Tip:</strong> Each lab runs right in your browser. Edit the files, watch the preview update, and the guide checks your work as you type.</p></blockquote>
<pre><code>git clone git@github.com:dali-lab/&lt;project&gt;.git
cd &lt;project&gt;
npm install
npm run dev</code></pre>`
    }],

    lab: {
      title: 'Say hello to DALI',
      intro: 'Edit a tiny page so it introduces you, then make it respond to a click.',
      defaultFile: 'index.html',
      files: {
        'index.html': `<main class="card">
  <h1>Hello, world</h1>
  <p>I just joined the DALI Lab.</p>
</main>`,
        'styles.css': `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  color: #082330;
}

.card {
  background: white;
  padding: 32px 40px;
  border-radius: 24px;
  box-shadow: 0 8px 24px rgba(8, 35, 48, 0.08);
}

button {
  margin-top: 8px;
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  background: #ff8b81;
  color: #082330;
  font-weight: 600;
  cursor: pointer;
}`,
        'script.js': `console.log("Lab ready — start editing!");
`
      },
      steps: [
      {
        id: 'name',
        title: 'Make it yours',
        instructions: 'Change the `<h1>` from "Hello, world" to introduce yourself, like "Hi, I\'m Jordan".',
        hint: 'Edit the text between `<h1>` and `</h1>` in index.html.',
        check: "(function(){var h=document.querySelector('h1');return !!h && h.textContent.trim().length>0 && !/hello, world/i.test(h.textContent)})()"
      },
      {
        id: 'button',
        title: 'Add a button',
        instructions: 'Below the paragraph, add a `<button>` with the text `Say hi`.',
        hint: 'Add `<button>Say hi</button>` inside the `<main>` element.',
        check: "(function(){var b=document.querySelector('button');return !!b && b.textContent.trim()==='Say hi'})()"
      },
      {
        id: 'click',
        title: 'Make it talk',
        instructions: 'In script.js, log a message that mentions `DALI` to the console whenever the button is clicked.',
        hint: 'Use `document.querySelector("button").addEventListener("click", () => console.log("Hi from DALI!"))`.',
        check: "(function(){var b=document.querySelector('button');if(!b)return false;var said=false;var orig=console.log;console.log=function(){var t=Array.prototype.join.call(arguments,' ');if(/dali/i.test(t))said=true;return orig.apply(console,arguments)};b.click();console.log=orig;return said})()"
      }]

    }
  },
  {
    id: 'html-css',
    title: 'Semantic HTML & CSS',
    summary: 'Structure pages so they are accessible by default, and lay them out with modern CSS.',
    quiz: {
      title: 'Semantics & layout check',
      intro: 'A quick check on the ideas behind the lab before you move on.',
      passingScore: 75,
      questions: [
      {
        id: 'hc-q1',
        type: 'multiple-choice',
        prompt: 'Which element best wraps a self-contained member card?',
        options: [
        { id: 'hc-q1-a', text: '<div>' },
        { id: 'hc-q1-b', text: '<article>' },
        { id: 'hc-q1-c', text: '<span>' },
        { id: 'hc-q1-d', text: '<section>' }],

        correctOptionId: 'hc-q1-b',
        explanation: 'An <article> is content that makes sense on its own, like a card, post, or comment.'
      },
      {
        id: 'hc-q2',
        type: 'multiple-choice',
        prompt: 'Which property adds consistent spacing between flex items?',
        options: [
        { id: 'hc-q2-a', text: 'margin' },
        { id: 'hc-q2-b', text: 'padding' },
        { id: 'hc-q2-c', text: 'gap' }],

        correctOptionId: 'hc-q2-c',
        explanation: 'gap spaces items evenly without extra margins on the first or last item.'
      },
      {
        id: 'hc-q3',
        type: 'short-answer',
        prompt: 'What CSS display value turns an element into a flex container?',
        acceptedAnswers: ['flex', 'display: flex', 'display:flex'],
        explanation: 'display: flex lays out direct children in a row by default.'
      },
      {
        id: 'hc-q4',
        type: 'short-answer',
        prompt: 'In one or two sentences, why do semantic elements matter on DALI partner projects?',
        acceptedAnswers: [],
        explanation: 'They make pages usable with screen readers and pass accessibility review without rework.'
      }]

    },
    duration: '35 min',
    dependsOn: ['dev-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'semantics',
      title: 'Why semantics matter',
      content: `<p>Screen readers, search engines, and your teammates all read your markup. Choosing <code>&lt;article&gt;</code>, <code>&lt;nav&gt;</code>, and real headings over generic <code>&lt;div&gt;</code>s makes pages understandable without extra work.</p>
<pre><code>&lt;article class="member"&gt;
  &lt;h2&gt;Ada Lovelace&lt;/h2&gt;
  &lt;p&gt;Developer · Spring '27&lt;/p&gt;
&lt;/article&gt;</code></pre>
<blockquote><p>DALI partner projects are reviewed for accessibility before launch. Starting semantic saves painful rework later.</p></blockquote>`
    },
    {
      id: 'layout',
      title: 'Laying things out with flexbox',
      content: `<p>Flexbox lines items up in one direction. Set <code>display: flex</code> on the parent, then use <code>gap</code> for spacing and <code>align-items</code> to line things up across the row.</p>
<pre><code>.member {
  display: flex;
  align-items: center;
  gap: 16px;
}</code></pre>`
    }],

    lab: {
      title: 'Build a member card',
      intro: 'Turn a pile of generic divs into a semantic, nicely laid-out member card.',
      defaultFile: 'index.html',
      files: {
        'index.html': `<div class="member">
  <div class="avatar">AL</div>
  <div>
    <div class="name">Ada Lovelace</div>
    <p class="role">Developer · Spring '27</p>
  </div>
</div>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 40px;
  color: #082330;
}

.member {
  background: white;
  padding: 20px;
  border-radius: 16px;
  max-width: 360px;
}

.avatar {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: #a8d3de;
  font-weight: 700;
}

.role {
  margin: 4px 0 0;
  color: #5b6770;
}`
      },
      steps: [
      {
        id: 'article',
        title: 'Use an article',
        instructions: 'Replace the outer `<div class="member">` with `<article class="member">` (and its closing tag).',
        check: "!!document.querySelector('article.member')"
      },
      {
        id: 'heading',
        title: 'Make the name a heading',
        instructions: 'Swap `<div class="name">` for an `<h2>` so the name is a real heading.',
        hint: 'You can keep the class: `<h2 class="name">Ada Lovelace</h2>`.',
        check: "(function(){var h=document.querySelector('.member h2');return !!h && h.textContent.trim().length>0})()"
      },
      {
        id: 'flex',
        title: 'Lay it out in a row',
        instructions: 'In styles.css, give `.member` `display: flex`, `align-items: center`, and a `gap`.',
        check: "(function(){var m=document.querySelector('.member');return !!m && getComputedStyle(m).display==='flex'})()"
      },
      {
        id: 'round',
        title: 'Round the avatar',
        instructions: 'Make `.avatar` a circle with `border-radius: 50%`.',
        check: "(function(){var a=document.querySelector('.avatar');return !!a && parseFloat(getComputedStyle(a).borderTopLeftRadius)>=24})()"
      }]

    }
  },
  {
    id: 'js-basics',
    title: 'JavaScript & the DOM',
    summary: 'Select elements, respond to events, and keep state in sync with what is on screen.',
    duration: '40 min',
    dependsOn: ['dev-welcome'],
    position: { x: 360, y: 300 },
    pages: [
    {
      id: 'events',
      title: 'Events and state',
      content: `<p>Interactive UI is a loop: the user does something, you update some state, then you update the screen to match. Keep that loop small and explicit.</p>
<pre><code>let count = 0;
button.addEventListener("click", () =&gt; {
  count += 1;
  countEl.textContent = count;
});</code></pre>`
    },
    {
      id: 'guarding',
      title: 'Guarding against bad states',
      content: `<p>Real features have limits: a room only fits so many people, a form needs a valid email. Disable controls when an action no longer makes sense instead of letting users hit an error.</p>
<blockquote><p><strong>Tip:</strong> A disabled <code>&lt;button&gt;</code> ignores clicks, including programmatic <code>.click()</code> calls, which makes it a reliable guard.</p></blockquote>`
    }],

    lab: {
      title: 'Room check-in counter',
      intro: 'Build the check-in counter for a DALI meeting room that holds five people.',
      defaultFile: 'script.js',
      files: {
        'index.html': `<section class="counter">
  <p class="label">Checked in to Sudikoff 001</p>
  <p id="count">0</p>
  <button id="check-in">Check in</button>
</section>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  display: grid;
  place-items: center;
  min-height: 100vh;
  margin: 0;
  color: #082330;
}

.counter { text-align: center; }
.label { color: #5b6770; margin: 0; }
#count { font-size: 64px; font-weight: 700; margin: 8px 0 16px; }

button {
  padding: 10px 20px;
  border: 0;
  border-radius: 999px;
  background: #00adab;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

button:disabled { background: #c6cacc; cursor: not-allowed; }`,
        'script.js': `const countEl = document.querySelector("#count");
const button = document.querySelector("#check-in");
let count = 0;

// Increase the count when the button is clicked
`
      },
      steps: [
      {
        id: 'increment',
        title: 'Count check-ins',
        instructions: 'When the button is clicked, add one to `count` and show it in `#count`.',
        hint: 'Inside a click listener: `count += 1; countEl.textContent = count;`',
        check: "(function(){var b=document.querySelector('#check-in');var o=document.querySelector('#count');if(!b||!o)return false;var before=Number(o.textContent);b.click();return Number(o.textContent)===before+1})()"
      },
      {
        id: 'capacity',
        title: 'Stop at capacity',
        instructions: 'The room holds 5 people. Disable the button once the count reaches 5.',
        hint: 'After updating the count, add `if (count >= 5) button.disabled = true;`',
        check: "(function(){var b=document.querySelector('#check-in');var o=document.querySelector('#count');if(!b||!o)return false;for(var i=0;i<10;i++)b.click();return b.disabled===true && Number(o.textContent)===5})()"
      }]

    }
  },
  {
    id: 'components',
    title: 'Thinking in components',
    summary: 'Break UI into small modules that turn data into markup, the idea React is built on.',
    duration: '45 min',
    dependsOn: ['html-css', 'js-basics'],
    position: { x: 720, y: 40 },
    pages: [
    {
      id: 'data-to-ui',
      title: 'UI is a function of data',
      content: `<p>Instead of editing the page by hand, describe what one item looks like, then render a list of them from data. This is exactly how React components work.</p>
<pre><code>export function ProjectItem(project) {
  return "&lt;li&gt;" + project.name + "&lt;/li&gt;";
}

list.innerHTML = projects.map(ProjectItem).join("");</code></pre>
<p>Real projects split this across files: data in one place, components in another, and a small entry file that wires them together. This module's lab is set up that way.</p>`
    },
    {
      id: 'to-react',
      title: 'The same idea in React',
      content: `<pre><code>function ProjectItem({ project }) {
  return &lt;li&gt;{project.name}&lt;/li&gt;;
}

projects.map((p) =&gt; &lt;ProjectItem key={p.name} project={p} /&gt;);</code></pre>
<blockquote><p>Once this clicks, the React onboarding docs in each project repo will feel familiar.</p></blockquote>`
    }],

    lab: {
      title: 'Render projects from data',
      intro: 'This lab is a small multi-file project. Write a component in `src/components`, then use it from `src/main.js` to render the project list.',
      defaultFile: 'src/components/ProjectItem.js',
      files: {
        'index.html': `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Active projects</h1>
    <ul id="projects"></ul>
    <script type="module" src="src/main.js"></script>
  </body>
</html>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 32px;
  color: #082330;
}

ul { list-style: none; padding: 0; display: grid; gap: 8px; max-width: 420px; }
li {
  background: white;
  padding: 12px 16px;
  border-radius: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #ffe7a5;
}`,
        'src/data/projects.js': `export const projects = [
  { name: "Timesheet", partner: "DALI", status: "Shipping" },
  { name: "Trail Finder", partner: "Outing Club", status: "Design" },
  { name: "Lab Inventory", partner: "Thayer", status: "Discovery" },
];
`,
        'src/components/ProjectItem.js': `// Return an HTML string for one project
export function ProjectItem(project) {
  return "";
}
`,
        'src/main.js': `import { projects } from "./data/projects.js";
import { ProjectItem } from "./components/ProjectItem.js";

// Render every project into #projects
`
      },
      steps: [
      {
        id: 'render',
        title: 'Render a list item per project',
        instructions: 'Make `ProjectItem` return an `<li>` string, then render all projects into `#projects` from `src/main.js`.',
        hint: 'In src/main.js: `document.querySelector("#projects").innerHTML = projects.map(ProjectItem).join("");`',
        check: "document.querySelectorAll('#projects li').length===3"
      },
      {
        id: 'names',
        title: 'Show each project name',
        instructions: 'Each `<li>` should include the project name.',
        check: "(function(){var names=['Timesheet','Trail Finder','Lab Inventory'];var items=document.querySelectorAll('#projects li');return items.length===3 && Array.prototype.every.call(items,function(li,i){return li.textContent.indexOf(names[i])>-1})})()"
      },
      {
        id: 'status',
        title: 'Add a status badge',
        instructions: 'Inside each item, add a `<span class="status">` showing the project status.',
        check: "document.querySelectorAll('#projects li .status').length===3"
      }]

    }
  },
  {
    id: 'git-workflow',
    title: 'Git & the PR workflow',
    summary: 'Branches, commits, and pull requests the way DALI teams use them.',
    quiz: {
      title: 'Git workflow check',
      intro: 'Make sure you know how changes get from your laptop to a partner project.',
      passingScore: 100,
      questions: [
      {
        id: 'git-q1',
        type: 'multiple-choice',
        prompt: 'You picked up ticket TS-142. What do you do first?',
        options: [
        { id: 'git-q1-a', text: 'Commit straight to main' },
        { id: 'git-q1-b', text: 'Create a branch named after the ticket' },
        { id: 'git-q1-c', text: 'Fork the repository' }],

        correctOptionId: 'git-q1-b',
        explanation: 'One ticket, one branch, named so reviewers can find the ticket.'
      },
      {
        id: 'git-q2',
        type: 'short-answer',
        prompt: 'Which git command uploads your branch to GitHub for the first time? (Just the command name after "git".)',
        acceptedAnswers: ['push', 'git push', 'push -u origin', 'git push -u origin'],
        explanation: 'git push -u origin <branch> pushes and sets the upstream so later pushes are just git push.'
      },
      {
        id: 'git-q3',
        type: 'multiple-choice',
        prompt: 'Who should you request a review from on a partner project?',
        options: [
        { id: 'git-q3-a', text: 'Nobody, merge when it works' },
        { id: 'git-q3-b', text: 'The partner' },
        { id: 'git-q3-c', text: 'A teammate and your dev mentor' }],

        correctOptionId: 'git-q3-c'
      }]

    },
    duration: '25 min',
    dependsOn: ['js-basics'],
    position: { x: 720, y: 320 },
    pages: [
    {
      id: 'branches',
      title: 'One ticket, one branch',
      content: `<p>Every ticket gets its own branch named after it. Keep branches short-lived: open a pull request within a couple of days, even if it is a draft.</p>
<pre><code>git checkout -b feat/TS-142-overtime-warning
git add .
git commit -m "Warn when weekly hours exceed 20"
git push -u origin feat/TS-142-overtime-warning</code></pre>`
    },
    {
      id: 'reviews',
      title: 'Opening a good pull request',
      content: `<ul>
<li><p>Link the ticket and describe what changed and why</p></li>
<li><p>Add screenshots or a short clip for anything visual</p></li>
<li><p>Request review from one teammate and your dev mentor</p></li>
</ul>
<blockquote><p><strong>Heads up:</strong> Never push directly to main on a partner project. Branch protection will block you, and that is on purpose.</p></blockquote>`
    }]

  },
  {
    id: 'first-ticket',
    title: 'Ship your first ticket',
    summary: 'Pick up a real-shaped bug, fix it, and walk through how it would go out to a partner.',
    duration: '45 min',
    dependsOn: ['components', 'git-workflow'],
    position: { x: 1080, y: 180 },
    pages: [
    {
      id: 'the-ticket',
      title: 'The ticket',
      content: `<blockquote><p><strong>TS-118</strong> · Weekly total shows "21.53" hours instead of 6.5 for some members.</p></blockquote>
<p>Bugs like this usually come from data arriving in a different shape than expected. Here, some hour values come back from the API as strings.</p>`
    },
    {
      id: 'shipping',
      title: 'From fix to production',
      content: `<ol>
<li><p>Reproduce the bug and write down the steps in the PR</p></li>
<li><p>Fix it at the source, not just where it shows up</p></li>
<li><p>Get a review, merge, and confirm on the staging build</p></li>
</ol>`
    }],

    lab: {
      title: 'Fix the weekly hours bug',
      intro: 'The timesheet total is wrong. Find out why and fix it.',
      defaultFile: 'script.js',
      files: {
        'index.html': `<section class="sheet">
  <p class="label">This week</p>
  <p><span id="total"></span> hours logged</p>
</section>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 40px;
  color: #082330;
}
.sheet { background: white; padding: 24px; border-radius: 16px; max-width: 320px; }
.label { margin: 0; color: #5b6770; }
#total { font-size: 32px; font-weight: 700; }`,
        'script.js': `const entries = [
  { day: "Mon", hours: 2 },
  { day: "Tue", hours: "1.5" },
  { day: "Wed", hours: 3 },
];

function totalHours(list) {
  return list.reduce((sum, entry) => sum + entry.hours, 0);
}

console.log("Total:", totalHours(entries));
document.querySelector("#total").textContent = totalHours(entries);
`
      },
      steps: [
      {
        id: 'total',
        title: 'Show the right total',
        instructions: 'The page should show `6.5` hours. Look at the console output to see what is going wrong.',
        hint: 'One of the hours is a string, so `+` joins text instead of adding. Convert with `Number(entry.hours)`.',
        check: "(function(){var t=document.querySelector('#total');return !!t && t.textContent.trim()==='6.5'})()"
      },
      {
        id: 'robust',
        title: 'Fix it at the source',
        instructions: 'Make sure `totalHours` itself handles string hours, not just this one list.',
        check: "typeof totalHours==='function' && totalHours([{hours:'2'},{hours:1}])===3"
      }]

    }
  }]

};

export const apisDataJourney: Journey = {
  id: 'apis-data',
  title: 'APIs & data',
  description: 'Work with the DALI API: fetch data, handle loading and errors, and shape responses for the UI.',
  modules: [
  {
    id: 'api-welcome',
    title: 'How DALI apps talk to servers',
    summary: 'Requests, responses, and where the DALI API fits into a partner project.',
    duration: '15 min',
    dependsOn: [],
    position: { x: 0, y: 150 },
    pages: [
    {
      id: 'request-response',
      title: 'Requests and responses',
      content: `<p>Most DALI apps are a React front end talking to a Node API. The front end asks for data with a request, and the API answers with JSON.</p>
<pre><code>const res = await fetch("/api/members");
const members = await res.json();</code></pre>`
    }]

  },
  {
    id: 'json-shapes',
    title: 'Working with JSON',
    summary: 'Filter, sort, and count API data before it reaches the screen.',
    duration: '30 min',
    dependsOn: ['api-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'array-methods',
      title: 'Array methods you will use daily',
      content: `<ul>
<li><p><code>filter</code> keeps the items you want</p></li>
<li><p><code>map</code> turns each item into something new</p></li>
<li><p><code>sort</code> puts them in order</p></li>
</ul>
<pre><code>const active = members.filter((m) =&gt; m.status === "active");</code></pre>`
    }],

    lab: {
      title: 'Shape the members list',
      intro: 'The API returned every member. Show only active ones, sorted by name.',
      defaultFile: 'script.js',
      files: {
        'index.html': `<h1>Members</h1>
<p><span id="active-count">0</span> active members</p>
<ul id="names"></ul>`,
        'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f1f3f4;
  padding: 32px;
  color: #082330;
}
#active-count { font-weight: 700; }`,
        'script.js': `const members = [
  { name: "Riya", status: "active" },
  { name: "Cam", status: "alumni" },
  { name: "Ana", status: "active" },
  { name: "Theo", status: "active" },
  { name: "Mo", status: "alumni" },
];

// 1. Show how many members are active in #active-count
// 2. List the active members' names in #names, sorted A to Z
`
      },
      steps: [
      {
        id: 'count',
        title: 'Count active members',
        instructions: 'Use `filter` to find active members and show the count in `#active-count`.',
        check: "document.querySelector('#active-count').textContent.trim()==='3'"
      },
      {
        id: 'sorted',
        title: 'List them A to Z',
        instructions: 'Render each active member as an `<li>` in `#names`, sorted alphabetically.',
        hint: 'Chain `.map((m) => m.name).sort()` before building the list.',
        check: "Array.prototype.map.call(document.querySelectorAll('#names li'),function(li){return li.textContent.trim()}).join(',')==='Ana,Riya,Theo'"
      }]

    }
  },
  {
    id: 'async-states',
    title: 'Loading & error states',
    summary: 'Design for the moments before data arrives, and for when it never does.',
    duration: '20 min',
    dependsOn: ['api-welcome'],
    position: { x: 360, y: 280 },
    pages: [
    {
      id: 'three-states',
      title: 'Every request has three states',
      content: `<p>Loading, success, and error. Partners notice a blank screen or a silent failure long before they notice a nice animation.</p>
<blockquote><p><strong>Tip:</strong> Show a skeleton that matches the final layout so the page does not jump when data arrives.</p></blockquote>`
    }]

  },
  {
    id: 'data-view',
    title: 'Ship a data-driven view',
    summary: 'Put it together: fetch, shape, and render a real screen with every state handled.',
    duration: '30 min',
    dependsOn: ['json-shapes', 'async-states'],
    position: { x: 720, y: 160 },
    pages: [
    {
      id: 'checklist',
      title: 'Before you open the PR',
      content: `<ul>
<li><p>Loading, empty, error, and success states are all designed</p></li>
<li><p>Data is shaped in one place, not inside the JSX</p></li>
<li><p>You tested with a slow network in dev tools</p></li>
</ul>`
    }]

  }]

};