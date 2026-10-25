import type { SeedJourney as Journey } from "./types";

const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const PRODUCT_POSTER = "/journeys/product-team.jpg";

export const pmEssentialsJourney: Journey = {
  id: 'pm-essentials',
  title: 'PM essentials',
  description: 'Run discovery with partners, keep your team unblocked, and plan sprints that ship.',
  recommended: true,
  modules: [
  {
    id: 'pm-welcome',
    title: 'Welcome to DALI Product',
    summary: 'What a DALI PM is accountable for, and who you will work with.',
    duration: '15 min',
    dependsOn: [],
    position: { x: 0, y: 150 },
    pages: [
    {
      id: 'role',
      title: 'The PM role at DALI',
      content: `<video src="${SAMPLE_VIDEO}" poster="${PRODUCT_POSTER}" controls="true" preload="none"></video>
<p><em>Being the bridge between partner and team · 3:48</em></p>
<p>You are the partner's main point of contact and your team's shield. You decide what gets built each sprint and make sure everyone knows why.</p>`
    }]

  },
  {
    id: 'partner-discovery',
    title: 'Partner discovery',
    summary: 'Turn a vague partner idea into a problem worth solving this term.',
    duration: '30 min',
    dependsOn: ['pm-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'interviews',
      title: 'The kickoff interview',
      content: `<ul>
<li><p>Who has this problem today, and how do they work around it?</p></li>
<li><p>What would be different at the end of the term if this went well?</p></li>
<li><p>What is explicitly out of scope?</p></li>
</ul>
<blockquote><p><strong>Tip:</strong> Bring your designer to every discovery call. Second-hand notes lose the details that matter.</p></blockquote>`
    }]

  },
  {
    id: 'standups',
    title: 'Running standups',
    summary: 'Short, useful check-ins that surface blockers early.',
    duration: '15 min',
    dependsOn: ['pm-welcome'],
    position: { x: 360, y: 280 },
    pages: [
    {
      id: 'format',
      title: 'A 10-minute format',
      content: `<p>Each person shares what they shipped, what is next, and anything blocking them. Problem-solving happens after, with only the people who need to be there.</p>`
    }]

  },
  {
    id: 'writing-tickets',
    title: 'Writing tickets',
    summary: 'Tickets that a developer can pick up without a follow-up question.',
    quiz: {
      title: 'Ticket writing check',
      intro: '',
      passingScore: 67,
      questions: [
      {
        id: 'tk-q1',
        type: 'multiple-choice',
        prompt: 'A ticket has six acceptance criteria. What should you do?',
        options: [
        { id: 'tk-q1-a', text: 'Ship it, more detail is better' },
        { id: 'tk-q1-b', text: 'Split it into smaller tickets' },
        { id: 'tk-q1-c', text: 'Remove the "Why" section to save space' }],

        correctOptionId: 'tk-q1-b',
        explanation: 'More than about three criteria usually means the ticket covers more than one change.'
      },
      {
        id: 'tk-q2',
        type: 'short-answer',
        prompt: 'Which section of a ticket explains the reason behind the work?',
        acceptedAnswers: ['why', 'the why', 'why section']
      },
      {
        id: 'tk-q3',
        type: 'short-answer',
        prompt: 'Rewrite this vague ticket title so a developer knows what to build: "Fix hours thing".',
        acceptedAnswers: [],
        explanation: 'Good titles name the behavior, e.g. "Warn when weekly hours exceed 20".'
      }]

    },
    duration: '25 min',
    dependsOn: ['partner-discovery'],
    position: { x: 720, y: 40 },
    pages: [
    {
      id: 'anatomy',
      title: 'Anatomy of a good ticket',
      content: `<h3>TS-142 Warn when weekly hours exceed 20</h3>
<p><strong>Why:</strong> Student workers can't exceed 20 hours a week.</p>
<p><strong>Done when:</strong></p>
<ul>
<li><p>A banner appears at 18+ hours</p></li>
<li><p>Submitting above 20 is blocked</p></li>
</ul>
<p><strong>Design:</strong> Figma › Timesheet › Overtime</p>
<blockquote><p>If a ticket needs more than three acceptance criteria, it is probably two tickets.</p></blockquote>`
    }]

  },
  {
    id: 'sprint-planning',
    title: 'Sprint planning',
    summary: 'Commit to a sprint your team can actually finish.',
    duration: '30 min',
    dependsOn: ['writing-tickets', 'standups'],
    position: { x: 1080, y: 160 },
    pages: [
    {
      id: 'planning',
      title: 'Planning a two-week sprint',
      content: `<ol>
<li><p>Start from the demo you want to show the partner</p></li>
<li><p>Pull tickets until the team says it is full, then remove one</p></li>
<li><p>Leave room for bugs and review time</p></li>
</ol>`
    }]

  }]

};

export const partnerManagementJourney: Journey = {
  id: 'partner-management',
  title: 'Partner management',
  description: 'Own the partner relationship from kickoff to end-of-term handoff.',
  modules: [
  {
    id: 'partner-welcome',
    title: 'Owning the relationship',
    summary: 'What partners expect from their DALI PM, and what you can expect from them.',
    duration: '10 min',
    dependsOn: [],
    position: { x: 0, y: 150 },
    pages: [
    {
      id: 'expectations',
      title: 'Setting expectations early',
      content: `<p>Agree on a meeting cadence, a single point of contact, and how decisions get made in your first call. Everything else gets easier.</p>`
    }]

  },
  {
    id: 'weekly-updates',
    title: 'Weekly partner updates',
    summary: 'Short written updates that keep partners confident.',
    duration: '15 min',
    dependsOn: ['partner-welcome'],
    position: { x: 360, y: 40 },
    pages: [
    {
      id: 'format',
      title: 'A three-part update',
      content: `<p><strong>Shipped:</strong> Overtime warning, export to CSV</p>
<p><strong>Next:</strong> Manager approvals</p>
<p><strong>Need from you:</strong> Final wording for the warning banner</p>`
    }]

  },
  {
    id: 'scope-changes',
    title: 'Handling scope changes',
    summary: 'Say yes to the right things and trade off the rest.',
    duration: '20 min',
    dependsOn: ['partner-welcome'],
    position: { x: 360, y: 280 },
    pages: [
    {
      id: 'tradeoffs',
      title: 'Every yes is a trade',
      content: `<blockquote><p><strong>Heads up:</strong> Never accept new scope in a meeting. Say you will come back with what it would replace.</p></blockquote>`
    }]

  },
  {
    id: 'handoff',
    title: 'End-of-term handoff',
    summary: 'Leave the partner and the next team set up to succeed.',
    duration: '20 min',
    dependsOn: ['weekly-updates', 'scope-changes'],
    position: { x: 720, y: 160 },
    pages: [
    {
      id: 'handoff-doc',
      title: 'The handoff doc',
      content: `<ul>
<li><p>What shipped and where it lives</p></li>
<li><p>Known issues and open tickets</p></li>
<li><p>Who to contact for access and credentials</p></li>
</ul>`
    }]

  }]

};