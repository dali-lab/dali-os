// Vocabulary and seed content for the Lab Term Timeline (/milestones).
//
// The live timeline lives in the database (TimelineWeek and friends), one set
// of weeks per Term. These defaults are what a term's timeline is seeded from
// the first time the page is opened, and what the page falls back to when
// there is no Term row at all (a fresh database) — so the page always renders
// something, even before anyone has edited it.

export type Domain = {
  key: string;
  name: string;
  /** Brand hex owning this domain's stripe/dot. Stays vivid in dark mode. */
  color: string;
};

export type Milestone = {
  name: string;
  detail: string;
  /** Lab-wide events (Prod Tales, Bug Hunt, Technigala) get the coral banner;
   *  team milestones are hit by each team on its own. */
  labWide: boolean;
};

export type Lane = {
  role: string;
  deliverables: string[];
  challenge: string;
};

export type Week = {
  title: string;
  dates: string;
  blurb: string;
  milestones: Milestone[];
  /** One lane per entry in DOMAINS, in the same order. */
  lanes: Lane[];
  resources: string[];
};

/** Shown when there is no Term row to name the timeline after. */
export const DEFAULT_TERM_LABEL = "Fall 2026 · Weeks 0–9";

/** Term.season is a one-letter enum; the page spells it out. */
export const SEASON_LABELS: Record<string, string> = {
  W: "Winter",
  S: "Spring",
  X: "Summer",
  F: "Fall",
};

// Per-field typography overrides set from the edit toolbar and stored on the
// week (TimelineWeek.format). Keys are field paths — "title", "blurb",
// "milestone:<id>.name", "lane:<id>.role", "lane:<id>.deliverable.2",
// "resource.0" — so a field keeps its formatting as rows around it change.
export type FieldFormat = { size?: number; bold?: boolean; color?: string };
export type FormatMap = Record<string, FieldFormat>;

/** The toolbar's colour choices — the brand palette, plus a neutral. */
export const SWATCHES: { name: string; color: string }[] = [
  { name: "Navy", color: "#1E5779" },
  { name: "Teal", color: "#00ADAB" },
  { name: "Coral", color: "#FF8B81" },
  { name: "Yellow", color: "#FFD461" },
  { name: "Grey", color: "#7D8B93" },
];

export const DOMAINS: Domain[] = [
  { key: "pm", name: "Product Mgmt", color: "#1E5779" },
  { key: "design", name: "UI / UX Design", color: "#FFD461" },
  { key: "dev", name: "Fullstack Dev", color: "#00ADAB" },
  { key: "data", name: "Data / ML", color: "#509C81" },
];

export const DEFAULT_WEEKS: Week[] = [
  {
    title: "Kickoff",
    dates: "Sep 15 – 19",
    blurb:
      "Teams meet their partner, read the brief, and agree on how the term will run. Nothing is built yet; the week exists so every domain starts from the same picture of the problem.",
    milestones: [
      {
        name: "Team + partner kickoff",
        detail:
          "Every team meets its partner, signs the scope agreement, and posts a team charter in the lab channel by Friday.",
        labWide: false,
      },
    ],
    resources: ["Team charter template", "Partner brief", "Lab handbook"],
    lanes: [
      {
        role: "Own the kickoff agenda",
        deliverables: ["Scope agreement drafted", "Meeting cadence set"],
        challenge: "Partners often arrive with a solution in mind rather than a problem.",
      },
      {
        role: "Absorb the brief",
        deliverables: ["Moodboard started", "Existing product audit"],
        challenge: "Little to design against yet — resist jumping to screens.",
      },
      {
        role: "Survey the stack",
        deliverables: ["Repo scaffolded", "Environment notes"],
        challenge: "Handoff repos are frequently undocumented.",
      },
      {
        role: "Find the data",
        deliverables: ["Data access request sent", "Source inventory"],
        challenge: "Access approvals can take two weeks; start now.",
      },
    ],
  },
  {
    title: "Research",
    dates: "Sep 22 – 26",
    blurb:
      "The week for questions. Domains split: research talks to users, engineering probes feasibility, data profiles what actually exists.",
    milestones: [],
    resources: ["Interview guide", "Consent form"],
    lanes: [
      {
        role: "Recruit and schedule",
        deliverables: ["Five interviews booked", "Research plan approved"],
        challenge: "Recruiting slips easily — buffer a week.",
      },
      {
        role: "Run generative interviews",
        deliverables: ["Interview notes synthesized", "Two provisional personas"],
        challenge: "Synthesis takes longer than the interviews themselves.",
      },
      {
        role: "Spike the risky parts",
        deliverables: ["Feasibility spike written up", "Third-party API tested"],
        challenge: "Spikes turn into production code if left unlabeled.",
      },
      {
        role: "Profile the sources",
        deliverables: ["Data quality report", "Schema sketch"],
        challenge: "Real data is messier than the sample the partner shared.",
      },
    ],
  },
  {
    title: "Framing",
    dates: "Sep 29 – Oct 3",
    blurb:
      "Findings converge into a single problem statement the whole team can point at. Scope gets cut here rather than in week eight.",
    milestones: [
      {
        name: "Problem statement lock",
        detail:
          "Each team presents one problem statement and a cut list to their mentor. Anything not in scope is written down and dated.",
        labWide: false,
      },
    ],
    resources: ["Scoping worksheet", "Mentor sign-off form"],
    lanes: [
      {
        role: "Write the cut list",
        deliverables: ["Problem statement v1", "Prioritized feature list"],
        challenge: "Saying no to a partner request is uncomfortable but cheaper now.",
      },
      {
        role: "Map the flows",
        deliverables: ["User journey map", "Information architecture"],
        challenge: "Flows drawn before the problem is agreed get redrawn.",
      },
      {
        role: "Draft the architecture",
        deliverables: ["System diagram", "Data model v1"],
        challenge: "Over-engineering for a ten-week build.",
      },
      {
        role: "Set the target",
        deliverables: ["Baseline metric defined", "Labeling plan"],
        challenge: "Without a baseline there is nothing to claim improvement over.",
      },
    ],
  },
  {
    title: "Concepting",
    dates: "Oct 6 – 10",
    blurb:
      "Wide before narrow. Design explores multiple directions while engineering builds the skeleton that any of them could sit on.",
    milestones: [],
    resources: ["Sketch template", "Critique norms"],
    lanes: [
      {
        role: "Keep the partner in the loop",
        deliverables: ["Weekly update sent", "Risk log opened"],
        challenge: "Silence between check-ins breeds surprise.",
      },
      {
        role: "Explore three directions",
        deliverables: ["Low-fi wireframes", "Internal critique held"],
        challenge: "Converging on the first idea before critique.",
      },
      {
        role: "Build the shell",
        deliverables: ["Auth and routing working", "CI pipeline green"],
        challenge: "Infrastructure work is invisible in demos — communicate it.",
      },
      {
        role: "Prototype the pipeline",
        deliverables: ["Ingest script running", "First model baseline"],
        challenge: "Notebook code that never becomes a service.",
      },
    ],
  },
  {
    title: "Mid-term check",
    dates: "Oct 13 – 17",
    blurb:
      "Halfway. Every team shows what exists to a mentor panel and leaves with a written list of what to change.",
    milestones: [
      {
        name: "Prod Tales",
        detail:
          "The whole lab gathers. Every team gives a short, honest account of where the build stands — what shipped, what slipped, what changed in scope.",
        labWide: true,
      },
      {
        name: "Mentor mid-term review",
        detail:
          "A fifteen-minute demo to the mentor panel with the honest state of the build. All domains present, not just PM.",
        labWide: false,
      },
    ],
    resources: ["Review rubric", "Slide template", "Feedback form"],
    lanes: [
      {
        role: "Assemble the review",
        deliverables: ["Review deck", "Updated timeline"],
        challenge: "Rehearsing an hour before rarely goes well.",
      },
      {
        role: "Show a chosen direction",
        deliverables: ["Mid-fi mockups", "Component inventory"],
        challenge: "Presenting options instead of a decision stalls the panel.",
      },
      {
        role: "Demo something running",
        deliverables: ["Deployed staging build", "Two core endpoints"],
        challenge: "Demoing from localhost when staging is expected.",
      },
      {
        role: "Report the numbers",
        deliverables: ["Baseline results", "Evaluation notes"],
        challenge: "Metrics with no plain-language interpretation.",
      },
    ],
  },
  {
    title: "Build",
    dates: "Oct 20 – 24",
    blurb:
      "Heads-down. The longest stretch of uninterrupted implementation in the term, with design running just ahead of engineering.",
    milestones: [],
    resources: ["Sprint board", "Code review checklist"],
    lanes: [
      {
        role: "Unblock, do not add",
        deliverables: ["Blockers cleared within a day", "Scope frozen"],
        challenge: "Mid-build scope additions are the top cause of a rough week nine.",
      },
      {
        role: "Stay a sprint ahead",
        deliverables: ["Hi-fi screens for next sprint", "Design system components"],
        challenge: "Redesigning shipped screens instead of finishing new ones.",
      },
      {
        role: "Ship features",
        deliverables: ["Two features merged", "Test coverage on core paths"],
        challenge: "Long-lived branches that merge painfully.",
      },
      {
        role: "Move to a service",
        deliverables: ["Model served behind an endpoint", "Latency measured"],
        challenge: "Accuracy gains that the product cannot actually use.",
      },
    ],
  },
  {
    title: "Integration",
    dates: "Oct 27 – 31",
    blurb:
      "The seams get attention. Design, frontend, backend and data meet in one build and the gaps between them become visible.",
    milestones: [
      {
        name: "Feature-complete target",
        detail:
          "The scoped feature set is merged and demoable end to end. After this week the work is refinement, not addition.",
        labWide: false,
      },
    ],
    resources: ["Release checklist", "QA script"],
    lanes: [
      {
        role: "Call feature complete",
        deliverables: ["Cut list finalized", "Bug triage started"],
        challenge: "Declaring complete while three features are half-merged.",
      },
      {
        role: "Close the visual gaps",
        deliverables: ["Design QA pass", "Empty and error states"],
        challenge: "Empty states get designed last and rushed.",
      },
      {
        role: "Wire it together",
        deliverables: ["Frontend on real data", "Error handling in place"],
        challenge: "Integration bugs surface in the layer nobody owns.",
      },
      {
        role: "Hand off the model",
        deliverables: ["Inference integrated", "Fallback behavior defined"],
        challenge: "No plan for what happens when the model is wrong.",
      },
    ],
  },
  {
    title: "User testing",
    dates: "Nov 3 – 7",
    blurb:
      "The build meets people who did not make it. Findings are triaged into fix-now and write-down.",
    milestones: [],
    resources: ["Test protocol", "Findings tracker"],
    lanes: [
      {
        role: "Triage the findings",
        deliverables: ["Findings prioritized", "Partner briefed on changes"],
        challenge: "Treating every finding as a required fix.",
      },
      {
        role: "Run the sessions",
        deliverables: ["Five sessions run", "Severity-ranked issues"],
        challenge: "Leading questions that confirm the design.",
      },
      {
        role: "Fix and harden",
        deliverables: ["Priority bugs closed", "Performance pass"],
        challenge: "Fixing symptoms during testing week destabilizes the demo.",
      },
      {
        role: "Validate on real usage",
        deliverables: ["Evaluation on session data", "Edge cases logged"],
        challenge: "Test data that does not resemble live input.",
      },
    ],
  },
  {
    title: "Polish",
    dates: "Nov 10 – 14",
    blurb:
      "Freeze the code, write everything down, and rehearse. Documentation is a deliverable, not an afterthought.",
    milestones: [
      {
        name: "Bug Hunt",
        detail:
          "The lab swaps builds for an evening and breaks each other’s projects. Every team leaves with a triaged list of what to fix before the gala.",
        labWide: true,
      },
      {
        name: "Code freeze and handoff docs",
        detail:
          "Repository, README, deployment notes and design files are handed to the partner. Nothing merges after Friday except demo-blocking fixes.",
        labWide: false,
      },
    ],
    resources: ["Handoff template", "README checklist"],
    lanes: [
      {
        role: "Package the handoff",
        deliverables: ["Handoff document", "Retro scheduled"],
        challenge:
          "Handoffs written in the last two hours are the ones partners cannot use.",
      },
      {
        role: "Finish the file",
        deliverables: ["Design file cleaned and named", "Style documentation"],
        challenge: "Untitled layers no one else can navigate.",
      },
      {
        role: "Freeze and document",
        deliverables: ["README complete", "Deployment runbook"],
        challenge: "Undocumented environment variables block the partner entirely.",
      },
      {
        role: "Document the pipeline",
        deliverables: ["Model card written", "Retraining instructions"],
        challenge: "A pipeline only one person can run.",
      },
    ],
  },
  {
    title: "Technigala",
    dates: "Nov 17 – 21",
    blurb:
      "The term ends in public. Every team presents at Technigala, then closes the loop internally with a retro.",
    milestones: [
      {
        name: "Technigala",
        detail:
          "All teams demo to the lab, partners and the campus. Booth set up by 4pm, live build on a real device, one-minute pitch rehearsed.",
        labWide: true,
      },
      {
        name: "Team retro",
        detail: "Every team closes the term with a written retro posted to the lab board.",
        labWide: false,
      },
    ],
    resources: ["Booth guide", "Poster template", "Retro board"],
    lanes: [
      {
        role: "Run the booth",
        deliverables: ["Pitch rehearsed", "Retro held and posted"],
        challenge: "A demo that depends on conference wifi.",
      },
      {
        role: "Present the work",
        deliverables: ["Poster printed", "Case study drafted"],
        challenge: "Leaving the case study until after the term ends.",
      },
      {
        role: "Keep it standing",
        deliverables: ["Demo build pinned", "Offline fallback ready"],
        challenge: "A last-minute deploy on gala morning.",
      },
      {
        role: "Tell the data story",
        deliverables: ["Results visual", "Limitations stated"],
        challenge: "Overclaiming what the model can do.",
      },
    ],
  },
];
