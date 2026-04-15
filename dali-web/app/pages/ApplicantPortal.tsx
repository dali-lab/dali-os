import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { getUser, fetchWithAuth } from '@/lib/auth';
import type { UserInfo } from '@/lib/auth';

const API_BASE = import.meta.env.VITE_DALI_DB_URL ?? "http://localhost:3001";

// ─── Applicant stage ─────────────────────────────────────────────────────────
//
// Change CURRENT_STAGE to preview each view. The full flow is:
//
//   ApplicationOpen  →  Pending  →  InvitedToInterview  →  InterviewScheduled
//                           ↓              ↓                       ↓
//                       Rejected      (decline)            PostInterviewPending
//                                                            ↓      ↓      ↓
//                                                       Accepted Rejected Waitlisted

type ApplicantStage =
  | 'ApplicationOpen'
  | 'Pending'
  | 'Rejected'
  | 'InvitedToInterview'
  | 'InterviewScheduled'
  | 'PostInterviewPending'
  | 'Accepted'
  | 'Waitlisted';

const CYCLE_NAME = 'Fall 2026';

// Transform API slot to UI TimeSlot
function apiSlotToTimeSlot(slot: { startTime: string; endTime: string }, index: number): TimeSlot {
  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  return {
    id: `slot-${index}`,
    date: start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    time: `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    isoStart: slot.startTime,
    isoEnd: slot.endTime,
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionAccount extends UserInfo {
  name?: string;
  picture?: string;
}

interface Question {
  id: string;
  text: string;
  type: 'short_text' | 'long_text' | 'url' | 'select';
  required: boolean;
  options?: string[];
}

interface TimeSlot {
  id: string;
  date: string;      // display date
  time: string;      // display time range
  isoStart: string;  // for gcal link
  isoEnd: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
}

// ─── Roles ───────────────────────────────────────────────────────────────────

const ROLES: { value: string; label: string }[] = [
  { value: 'FULLSTACK', label: 'Full Stack' },
  { value: 'DATA', label: 'Data' },
  { value: 'ENGINES', label: 'Engines' },
  { value: 'AR_VR', label: 'AR/VR' },
  { value: 'UI_UX', label: 'UI/UX' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'PM', label: 'PM' },
  { value: 'THREE_D_MODELING', label: '3D Modeling' },
  { value: 'ANIMATION', label: 'Animation' },
];

// ─── Mock questions ──────────────────────────────────────────────────────────

const COMMON_QUESTIONS: Question[] = [
  { id: 'c1', text: 'Why are you interested in joining DALI?', type: 'long_text', required: true },
  { id: 'c2', text: 'Describe a project you are proud of and your role in it.', type: 'long_text', required: true },
  { id: 'c3', text: 'What year are you?', type: 'select', required: true, options: ["'27", "'28", "'29", 'Graduate'] },
  { id: 'c4', text: 'Resume URL', type: 'url', required: false },
];

const ROLE_QUESTIONS: Record<string, Question[]> = {
  FULLSTACK: [
    { id: 'fs1', text: 'What is your preferred tech stack and why?', type: 'long_text', required: true },
    { id: 'fs2', text: 'Link to a code project (GitHub, GitLab, etc.)', type: 'url', required: true },
    { id: 'fs3', text: 'Do you prefer frontend or backend work?', type: 'select', required: true, options: ['Frontend', 'Backend', 'Both equally'] },
  ],
  DATA: [
    { id: 'da1', text: 'Describe your experience with statistics or machine learning.', type: 'long_text', required: true },
    { id: 'da2', text: 'What data tools and languages are you proficient in? (e.g. Python, R, SQL)', type: 'short_text', required: true },
    { id: 'da3', text: 'Link to a data project or analysis you have done.', type: 'url', required: false },
  ],
  ENGINES: [
    { id: 'en1', text: 'What game engines or graphics frameworks have you worked with?', type: 'short_text', required: true },
    { id: 'en2', text: 'Describe a technical challenge you solved in a game or simulation project.', type: 'long_text', required: true },
  ],
  AR_VR: [
    { id: 'ar1', text: 'What AR/VR platforms or SDKs have you used? (e.g. Unity XR, ARKit, WebXR)', type: 'short_text', required: true },
    { id: 'ar2', text: 'Describe an immersive experience you have built or contributed to.', type: 'long_text', required: true },
  ],
  UI_UX: [
    { id: 'ux1', text: 'What design tools do you use? (e.g. Figma, Sketch, Adobe XD)', type: 'short_text', required: true },
    { id: 'ux2', text: 'Walk us through your design process for a recent project.', type: 'long_text', required: true },
    { id: 'ux3', text: 'Portfolio URL', type: 'url', required: true },
  ],
  VIDEO: [
    { id: 'vi1', text: 'What video editing software do you use?', type: 'short_text', required: true },
    { id: 'vi2', text: 'Link to a video or reel you have produced.', type: 'url', required: true },
  ],
  PM: [
    { id: 'pm1', text: 'Describe a time you led a team through a difficult project.', type: 'long_text', required: true },
    { id: 'pm2', text: 'What project management tools or methodologies are you familiar with?', type: 'short_text', required: true },
    { id: 'pm3', text: 'How do you handle conflicting priorities between team members?', type: 'long_text', required: true },
  ],
  THREE_D_MODELING: [
    { id: '3d1', text: 'What 3D modeling software do you use? (e.g. Blender, Maya, ZBrush)', type: 'short_text', required: true },
    { id: '3d2', text: 'Link to a portfolio or gallery of your 3D work.', type: 'url', required: true },
  ],
  ANIMATION: [
    { id: 'an1', text: 'What animation tools and techniques are you experienced with?', type: 'short_text', required: true },
    { id: 'an2', text: 'Link to an animation reel or portfolio.', type: 'url', required: true },
    { id: 'an3', text: 'Describe your animation workflow from concept to final render.', type: 'long_text', required: false },
  ],
};

// Interview slots are now fetched from the API — see InvitedToInterviewView

// ─── Mock onboarding checklist ───────────────────────────────────────────────

const ONBOARDING_CHECKLIST: ChecklistItem[] = [
  { id: 'ob1', label: 'Accept your offer', description: 'Confirm your acceptance by clicking the button below.' },
  { id: 'ob2', label: 'Complete the new member form', description: 'Fill out the onboarding form sent to your email with your T-shirt size, dietary restrictions, etc.' },
  { id: 'ob3', label: 'Join the DALI Slack workspace', description: 'Use the invite link in your acceptance email to join Slack.' },
  { id: 'ob4', label: 'Set up your development environment', description: 'Follow the setup guide pinned in #onboarding on Slack.' },
  { id: 'ob5', label: 'Attend the kickoff meeting', description: 'Monday, September 14 at 6:00 PM in DALI Lab (3rd floor, Sudikoff).' },
  { id: 'ob6', label: 'Complete intro training modules', description: 'Finish the assigned training modules in the DALI Learning Portal before Week 2.' },
];

// ─── Mock submitted answers (for read-only views) ────────────────────────────

const MOCK_SUBMITTED_ROLES = ['FULLSTACK', 'UI_UX'];
const MOCK_SUBMITTED_ANSWERS: Record<string, string> = {
  c1: 'I want to work on real products that help the Dartmouth community. DALI gives me the chance to collaborate with talented designers and developers while shipping software that matters.',
  c2: 'I built a campus event discovery app with two classmates. I handled the full-stack development — React frontend with a Node/Postgres backend. We got 200+ active users in the first month.',
  c3: "'28",
  c4: 'https://janedoe.dev',
  fs1: 'React + TypeScript on the frontend, Node.js + Prisma on the backend. I like this stack because the type safety is end-to-end and the DX is great.',
  fs2: 'https://github.com/janedoe/campus-events',
  fs3: 'Both equally',
  ux1: 'Figma, Framer',
  ux2: 'For the campus events app I started with user interviews, created personas, mapped flows in FigJam, then iterated on high-fidelity mockups in Figma before handing off with dev-ready specs.',
  ux3: 'https://janedoe.design',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSession(): { account: SessionAccount; type: string } | null {
  const user = getUser();
  if (!user) return null;
  return { account: user as SessionAccount, type: user.type };
}

function buildGoogleCalendarUrl(slot: TimeSlot): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `DALI Lab Interview — ${CYCLE_NAME}`,
    dates: `${slot.isoStart}/${slot.isoEnd}`,
    details: 'Your interview with the DALI Lab team. Please arrive 5 minutes early.',
    location: 'DALI Lab, 3rd Floor Sudikoff, Dartmouth College',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// group slots by date for cleaner display
function groupSlotsByDate(slots: TimeSlot[]): { date: string; slots: TimeSlot[] }[] {
  const map = new Map<string, TimeSlot[]>();
  for (const s of slots) {
    const group = map.get(s.date) ?? [];
    group.push(s);
    map.set(s.date, group);
  }
  return Array.from(map.entries()).map(([date, slots]) => ({ date, slots }));
}

// ─── Shared UI pieces ────────────────────────────────────────────────────────

const cardBg = 'bg-[#E8F4FA] dark:bg-[#0d2133]';
const inputBase = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d2133] text-sm text-nav-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-accent-coral px-4 py-2';

function StatusBadge({ label, variant }: { label: string; variant: 'blue' | 'green' | 'yellow' | 'red' | 'gray' }) {
  const styles: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${styles[variant]}`}>
      {label}
    </span>
  );
}

function PulsingDot({ color }: { color: string }) {
  return <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />;
}

/** Read-only view of the submitted application */
function SubmittedApplicationSummary({ badge }: { badge: React.ReactNode }) {
  // Collect role-specific questions for the submitted roles
  const roleQuestions = MOCK_SUBMITTED_ROLES.flatMap(r => (ROLE_QUESTIONS[r] ?? []).map(q => ({ ...q, _role: r })));
  const seenIds = new Set<string>();
  const uniqueRoleQs = roleQuestions.filter(q => { if (seenIds.has(q.id)) return false; seenIds.add(q.id); return true; });

  return (
    <div className={`rounded-2xl ${cardBg} overflow-hidden`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/60 dark:border-gray-700/40">
        <span className="font-heading text-sm font-bold text-nav-primary dark:text-white">{CYCLE_NAME} Application</span>
        {badge}
      </div>
      <div className="px-6 py-5 space-y-5">
        {/* Roles */}
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Roles Applied</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {MOCK_SUBMITTED_ROLES.map(r => (
              <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1929] text-nav-primary dark:text-white border border-gray-200 dark:border-gray-700">
                {ROLES.find(x => x.value === r)?.label ?? r}
              </span>
            ))}
          </div>
        </div>

        {/* Common answers */}
        {COMMON_QUESTIONS.map(q => {
          const answer = MOCK_SUBMITTED_ANSWERS[q.id];
          if (!answer) return null;
          return (
            <div key={q.id}>
              <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">{q.text}</span>
              <p className="text-sm text-nav-primary dark:text-white mt-1 whitespace-pre-wrap">{answer}</p>
            </div>
          );
        })}

        {/* Role-specific answers */}
        {MOCK_SUBMITTED_ROLES.map(role => {
          const qs = ROLE_QUESTIONS[role] ?? [];
          const answeredQs = qs.filter(q => MOCK_SUBMITTED_ANSWERS[q.id]);
          if (answeredQs.length === 0) return null;
          return (
            <div key={role} className="pt-3 border-t border-gray-200/60 dark:border-gray-700/40">
              <span className="text-xs font-bold text-accent-coral uppercase tracking-wider">
                {ROLES.find(x => x.value === role)?.label} Questions
              </span>
              <div className="space-y-3 mt-2">
                {answeredQs.map(q => (
                  <div key={q.id}>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">{q.text}</span>
                    <p className="text-sm text-nav-primary dark:text-white mt-1 whitespace-pre-wrap">{MOCK_SUBMITTED_ANSWERS[q.id]}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="pt-3 border-t border-gray-200/60 dark:border-gray-700/40">
          <span className="text-xs text-gray-400 dark:text-gray-500">Submitted on March 15, 2026</span>
        </div>
      </div>
    </div>
  );
}

/** Rejection view reused for both first-round and final-round rejections */
function RejectedView({ round }: { round: 'first' | 'final' }) {
  const [feedbackRequested, setFeedbackRequested] = useState(false);

  return (
    <motion.div
      className="max-w-2xl mx-auto py-12"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">
          Thank You for Applying
        </h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed max-w-lg mx-auto">
          {round === 'first'
            ? `Unfortunately, we are unable to move your application forward to the interview stage for ${CYCLE_NAME}. The applicant pool was extremely competitive this cycle.`
            : `After careful consideration following your interview, we are unable to offer you a position for ${CYCLE_NAME}. This was a very difficult decision given the strength of the candidates.`}
        </p>
      </div>

      {/* Request feedback */}
      <div className={`px-6 py-5 rounded-2xl ${cardBg}`}>
        <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider mb-2">
          Want to know more?
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          You can request feedback on your application. A member of the DALI team will follow up with you via email.
        </p>
        {feedbackRequested ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Feedback requested — we'll be in touch soon.
          </div>
        ) : (
          <button
            onClick={() => setFeedbackRequested(true)}
            className="px-5 py-2 rounded-full border-2 border-accent-coral text-accent-coral text-sm font-semibold hover:bg-accent-coral hover:text-white transition"
          >
            Request Feedback
          </button>
        )}
      </div>

      {/* Encouragement */}
      <div className={`mt-6 px-6 py-5 rounded-2xl ${cardBg}`}>
        <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider mb-3">
          Keep going
        </h3>
        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>We encourage you to apply again in future cycles.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>Check out our <Link to="/education" className="text-accent-coral hover:underline">workshops and courses</Link> to keep building your skills.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>Browse <Link to="/projects" className="text-accent-coral hover:underline">past projects</Link> for inspiration.</span>
          </li>
        </ul>
      </div>
    </motion.div>
  );
}

// ─── Stage: ApplicationOpen ──────────────────────────────────────────────────

function ApplicationOpenView() {
  const [started, setStarted] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collect role-specific questions for selected roles, deduped
  const roleQuestions = selectedRoles.flatMap(r => (ROLE_QUESTIONS[r] ?? []).map(q => ({ ...q, _role: r })));
  const seenIds = new Set<string>();
  const uniqueRoleQs = roleQuestions.filter(q => { if (seenIds.has(q.id)) return false; seenIds.add(q.id); return true; });

  // All questions for validation
  const allQuestions = [...COMMON_QUESTIONS, ...uniqueRoleQs];

  function handleSave() {
    setSaving(true);
    setTimeout(() => setSaving(false), 500);
  }

  async function handleSubmit() {
    setError(null);
    if (selectedRoles.length === 0) {
      setError('Please select at least one role.');
      return;
    }
    const missing = allQuestions.filter(q => q.required && !answers[q.id]?.trim());
    if (missing.length > 0) {
      setError(`Please answer all required questions (${missing.length} remaining).`);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/my-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: { ...answers, roles: selectedRoles.join(',') } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to submit application. Please try again.');
        return;
      }
    } catch {
      setError('Failed to submit application. Please try again.');
      return;
    }
    setSubmitted(true);
  }

  // Post-submission confirmation
  if (submitted) {
    return (
      <motion.div className="max-w-2xl mx-auto text-center py-16" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Application Submitted!</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
          Your application for {CYCLE_NAME} has been received. We'll review it and get back to you soon.
        </p>
        <div className={`px-6 py-5 rounded-2xl ${cardBg} text-left`}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-heading text-sm font-bold text-nav-primary dark:text-white">{CYCLE_NAME}</span>
            <StatusBadge label="Submitted" variant="green" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Roles: {selectedRoles.map(r => ROLES.find(x => x.value === r)?.label ?? r).join(', ')}
          </p>
        </div>
      </motion.div>
    );
  }

  // Landing — haven't started yet
  if (!started) {
    return (
      <motion.div className="max-w-2xl mx-auto text-center py-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Applications Are Open</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
          The {CYCLE_NAME} application cycle is now accepting applications. Start yours to join the DALI Lab!
        </p>
        <button onClick={() => setStarted(true)} className="px-8 py-3 rounded-full bg-accent-coral text-white font-semibold font-heading tracking-wider hover:bg-accent-coral/90 transition shadow-lg hover:shadow-xl">
          Start Application
        </button>
      </motion.div>
    );
  }

  // Application form
  return (
    <motion.div className="max-w-3xl mx-auto" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-heading text-xl font-bold text-nav-primary dark:text-white">{CYCLE_NAME} Application</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Fill out the form below. Your progress is saved automatically.</p>
        </div>
        <StatusBadge label="Draft" variant="blue" />
      </div>

      <div className="space-y-8">
        {/* Role selector */}
        <div className={`px-6 py-5 rounded-2xl ${cardBg}`}>
          <h3 className="font-heading text-base font-bold text-nav-primary dark:text-white mb-1">
            Roles <span className="text-accent-coral">*</span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Select every role you'd like to be considered for. Role-specific questions will appear below.</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map(r => (
              <button
                key={r.value}
                onClick={() => setSelectedRoles(prev => prev.includes(r.value) ? prev.filter(v => v !== r.value) : [...prev, r.value])}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedRoles.includes(r.value)
                    ? 'bg-accent-coral text-white border-accent-coral'
                    : 'bg-white dark:bg-[#0a1929] text-nav-primary dark:text-white border-gray-200 dark:border-gray-700 hover:border-accent-coral'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Common questions */}
        <div className="space-y-6">
          <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider">General Questions</h3>
          {COMMON_QUESTIONS.map(q => (
            <QuestionInput key={q.id} question={q} value={answers[q.id] ?? ''} onChange={v => setAnswers(prev => ({ ...prev, [q.id]: v }))} />
          ))}
        </div>

        {/* Role-specific questions — grouped by role */}
        <AnimatePresence mode="popLayout">
          {selectedRoles.map(role => {
            const qs = ROLE_QUESTIONS[role];
            if (!qs || qs.length === 0) return null;
            const roleLabel = ROLES.find(x => x.value === role)?.label ?? role;
            return (
              <motion.div
                key={role}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-6 overflow-hidden"
              >
                <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-accent-coral">{roleLabel} Questions</h3>
                {qs.map(q => (
                  <QuestionInput key={q.id} question={q} value={answers[q.id] ?? ''} onChange={v => setAnswers(prev => ({ ...prev, [q.id]: v }))} />
                ))}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-full border-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button onClick={handleSubmit} className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition">
            Submit Application
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{saving ? 'Saving...' : 'Auto-saved'}</span>
        </div>
      </div>
    </motion.div>
  );
}

function QuestionInput({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-nav-primary dark:text-white mb-1">
        {question.text}
        {question.required && <span className="text-accent-coral ml-0.5">*</span>}
      </label>
      {question.type === 'long_text' && (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={4} className={`${inputBase} resize-none`} placeholder="Your answer" />
      )}
      {question.type === 'short_text' && (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} className={inputBase} placeholder="Your answer" />
      )}
      {question.type === 'url' && (
        <input type="url" value={value} onChange={e => onChange(e.target.value)} className={inputBase} placeholder="https://" />
      )}
      {question.type === 'select' && (
        <select value={value} onChange={e => onChange(e.target.value)} className={`${inputBase} appearance-auto`}>
          <option value="">Select...</option>
          {(question.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Stage: Pending ──────────────────────────────────────────────────────────

function PendingView() {
  return (
    <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Application Pending Review</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          Your application is being reviewed by the DALI team. We'll update you here once a decision has been made.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-50 dark:bg-yellow-900/20 text-sm text-yellow-700 dark:text-yellow-400">
          <PulsingDot color="bg-yellow-500" />
          Pending
        </div>
      </div>

      <SubmittedApplicationSummary badge={<StatusBadge label="Pending" variant="yellow" />} />
    </motion.div>
  );
}

// ─── Stage: InvitedToInterview ───────────────────────────────────────────────

function InvitedToInterviewView({ appData, onBooked }: {
  appData: { id: string; cycleId: string; domainIds: string[] } | null;
  onBooked: (interview: { id: string; startTime: string; endTime: string; status: string }) => void;
}) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [booking, setBooking] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (!appData) return;
    const params = appData.domainIds.map(d => `domainId=${d}`).join('&');
    fetchWithAuth(`${API_BASE}/api/cycles/${appData.cycleId}/available-slots?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then((apiSlots: { startTime: string; endTime: string }[]) => {
        setSlots(apiSlots.map(apiSlotToTimeSlot));
      })
      .catch(() => {});
  }, [appData]);

  const grouped = groupSlotsByDate(slots);
  const slot = slots.find(s => s.id === selectedSlot);

  async function handleConfirm() {
    if (!slot || !appData) return;
    setBooking(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/cycles/${appData.cycleId}/book-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotStart: slot.isoStart, slotEnd: slot.isoEnd, applicationId: appData.id }),
      });
      if (res.ok) {
        const interview = await res.json();
        setConfirmed(true);
        onBooked({ id: interview.id, startTime: interview.startTime, endTime: interview.endTime, status: interview.status });
      }
    } finally {
      setBooking(false);
    }
  }

  if (declined) {
    return (
      <motion.div className="max-w-2xl mx-auto text-center py-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Interview Declined</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          You've declined the interview invitation. If you change your mind, please reach out to the DALI team.
        </p>
      </motion.div>
    );
  }

  if (confirmed && slot) {
    // → this mirrors InterviewScheduledView but inline after confirming
    return <InterviewConfirmation slot={slot} />;
  }

  return (
    <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">You're Invited to Interview!</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          Congratulations! The DALI team would like to interview you. Please select a time slot below.
        </p>
      </div>

      {/* Time slots */}
      <div className="space-y-6 mb-8">
        {grouped.map(({ date, slots }) => (
          <div key={date}>
            <h4 className="text-sm font-bold text-nav-primary dark:text-white mb-2">{date}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {slots.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSlot(s.id)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all text-left ${
                    selectedSlot === s.id
                      ? 'border-accent-coral bg-accent-coral/5 dark:bg-accent-coral/10 text-accent-coral'
                      : 'border-gray-200 dark:border-gray-700 text-nav-primary dark:text-white hover:border-accent-coral/50'
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleConfirm}
          disabled={!selectedSlot || booking}
          className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
        >
          Confirm Time
        </button>
        {declining ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Are you sure?</span>
            <button onClick={() => setDeclined(true)} className="text-sm font-semibold text-red-500 hover:underline">Yes, decline</button>
            <button onClick={() => setDeclining(false)} className="text-sm font-semibold text-gray-500 hover:underline">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setDeclining(true)} className="text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-red-500 transition">
            Decline Interview
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Stage: InterviewScheduled ───────────────────────────────────────────────

function InterviewScheduledView({ interview, appData, onCancelled, onRescheduled }: {
  interview: { id: string; startTime: string; endTime: string; status: string };
  appData: { id: string; cycleId: string; domainIds: string[] } | null;
  onCancelled: () => void;
  onRescheduled: (interview: { id: string; startTime: string; endTime: string; status: string }) => void;
}) {
  const slot = apiSlotToTimeSlot(interview, 0);
  return <InterviewConfirmation slot={slot} appData={appData} onCancelled={onCancelled} onRescheduled={onRescheduled} />;
}

/** Shared confirmation UI used by both InvitedToInterview (after confirm) and InterviewScheduled stage */
function InterviewConfirmation({ slot, appData, onCancelled, onRescheduled }: {
  slot: TimeSlot;
  appData?: { id: string; cycleId: string; domainIds: string[] } | null;
  onCancelled?: () => void;
  onRescheduled?: (interview: { id: string; startTime: string; endTime: string; status: string }) => void;
}) {
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<TimeSlot[]>([]);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [currentSlot, setCurrentSlot] = useState(slot);

  // Fetch available slots when rescheduling
  useEffect(() => {
    if (!rescheduling || !appData) return;
    const params = appData.domainIds.map((d: string) => `domainId=${d}`).join('&');
    fetchWithAuth(`${API_BASE}/api/cycles/${appData.cycleId}/available-slots?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then((apiSlots: { startTime: string; endTime: string }[]) => {
        setRescheduleSlots(apiSlots.map(apiSlotToTimeSlot).filter((s: TimeSlot) => s.isoStart !== currentSlot.isoStart));
      })
      .catch(() => {});
  }, [rescheduling, appData, currentSlot.isoStart]);

  const grouped = groupSlotsByDate(rescheduleSlots);

  if (declined) {
    return (
      <motion.div className="max-w-2xl mx-auto text-center py-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Interview Cancelled</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          Your interview has been cancelled. If this was a mistake, please reach out to the DALI team.
        </p>
      </motion.div>
    );
  }

  if (rescheduling) {
    return (
      <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h2 className="font-heading text-xl font-bold text-nav-primary dark:text-white mb-2">Reschedule Interview</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Currently scheduled: <strong>{currentSlot.date}, {currentSlot.time}</strong>. Pick a new time below.
        </p>
        <div className="space-y-6 mb-8">
          {grouped.map(({ date, slots }) => (
            <div key={date}>
              <h4 className="text-sm font-bold text-nav-primary dark:text-white mb-2">{date}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {slots.map(s => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      const res = await fetchWithAuth(`${API_BASE}/api/my-interview/reschedule`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ newStart: s.isoStart, newEnd: s.isoEnd }),
                      });
                      if (res.ok) {
                        const interview = await res.json();
                        setCurrentSlot(s);
                        setRescheduling(false);
                        onRescheduled?.({ id: interview.id, startTime: interview.startTime, endTime: interview.endTime, status: interview.status });
                      }
                    }}
                    className="px-4 py-3 rounded-xl text-sm font-medium border-2 border-gray-200 dark:border-gray-700 text-nav-primary dark:text-white hover:border-accent-coral/50 transition-all text-left"
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => setRescheduling(false)} className="text-sm font-semibold text-gray-500 hover:underline">Cancel</button>
      </motion.div>
    );
  }

  return (
    <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Interview Confirmed</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          You're all set! Here are your interview details.
        </p>
      </div>

      {/* Interview details card */}
      <div className={`px-6 py-6 rounded-2xl ${cardBg} mb-6`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Date & Time</span>
            <p className="text-lg font-bold text-nav-primary dark:text-white mt-1">{currentSlot.date}</p>
            <p className="text-sm text-nav-primary dark:text-white">{currentSlot.time}</p>
          </div>
          <StatusBadge label="Scheduled" variant="green" />
        </div>
        <div className="pt-4 border-t border-gray-200/60 dark:border-gray-700/40">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Location</span>
          <p className="text-sm text-nav-primary dark:text-white mt-1">DALI Lab, 3rd Floor Sudikoff, Dartmouth College</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={buildGoogleCalendarUrl(currentSlot)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Add to Google Calendar
        </a>
        <button onClick={() => setRescheduling(true)} className="px-5 py-2.5 rounded-full border-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-accent-coral hover:text-accent-coral transition">
          Reschedule
        </button>
        {declining ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Cancel interview?</span>
            <button onClick={async () => {
              const res = await fetchWithAuth(`${API_BASE}/api/my-interview/cancel`, { method: 'POST' });
              if (res.ok) { setDeclined(true); onCancelled?.(); }
            }} className="text-sm font-semibold text-red-500 hover:underline">Yes</button>
            <button onClick={() => setDeclining(false)} className="text-sm font-semibold text-gray-500 hover:underline">No</button>
          </div>
        ) : (
          <button onClick={() => setDeclining(true)} className="text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-red-500 transition">
            Decline
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Stage: PostInterviewPending ─────────────────────────────────────────────

function PostInterviewPendingView() {
  return (
    <motion.div className="max-w-2xl mx-auto py-12 text-center" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
        <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>
      <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">Interview Complete</h2>
      <p className="text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
        Thanks for interviewing with us! The team is reviewing all candidates and will share a final decision soon.
      </p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-600 dark:text-blue-400">
        <PulsingDot color="bg-blue-500" />
        Decision pending
      </div>
    </motion.div>
  );
}

// ─── Stage: Accepted ─────────────────────────────────────────────────────────

function AcceptedView() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const completedCount = Object.values(checked).filter(Boolean).length;
  const totalCount = ONBOARDING_CHECKLIST.length;

  return (
    <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="text-center mb-10">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-3xl font-bold text-nav-primary dark:text-white mb-3">Congratulations!</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed text-lg">
          You've been accepted to DALI Lab for {CYCLE_NAME}!
        </p>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-nav-primary dark:text-white">Onboarding Progress</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{completedCount}/{totalCount}</span>
        </div>
        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-accent-coral"
            initial={{ width: 0 }}
            animate={{ width: `${(completedCount / totalCount) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-gradient-to-br from-accent-green/5 to-accent-teal/5 dark:from-green-900/10 dark:to-teal-900/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-green-200/60 dark:border-green-800/40">
          <h3 className="font-heading text-base font-bold text-nav-primary dark:text-white">Onboarding Checklist</h3>
        </div>
        <div className="divide-y divide-green-100 dark:divide-green-900/30">
          {ONBOARDING_CHECKLIST.map(item => (
            <label key={item.id} className="flex items-start gap-4 px-6 py-4 cursor-pointer hover:bg-green-50/50 dark:hover:bg-green-900/10 transition">
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                onChange={e => setChecked(prev => ({ ...prev, [item.id]: e.target.checked }))}
                className="mt-0.5 w-5 h-5 rounded accent-accent-coral flex-shrink-0"
              />
              <div>
                <span className={`text-sm font-semibold transition-colors ${checked[item.id] ? 'text-gray-400 line-through' : 'text-nav-primary dark:text-white'}`}>
                  {item.label}
                </span>
                <p className={`text-xs mt-0.5 transition-colors ${checked[item.id] ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'}`}>
                  {item.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {completedCount === totalCount && (
        <motion.div className="mt-6 text-center" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-green/20 text-green-700 dark:text-green-300 text-sm font-semibold">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            All done — see you at kickoff!
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Stage: Waitlisted ───────────────────────────────────────────────────────

function WaitlistedView() {
  return (
    <motion.div className="max-w-2xl mx-auto py-12" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-nav-primary dark:text-white mb-3">You're on the Waitlist</h2>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed max-w-lg mx-auto">
          You performed well in the interview process and we'd love to have you at DALI. We've placed you on the waitlist for {CYCLE_NAME} and will reach out if a spot becomes available.
        </p>
      </div>

      <div className={`px-6 py-5 rounded-2xl ${cardBg}`}>
        <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider mb-3">
          What this means
        </h3>
        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>If a spot opens, we'll contact you by email. No action needed on your part.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>Waitlisted candidates are often extended offers for the following cycle.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>In the meantime, check out our <Link to="/education" className="text-accent-coral hover:underline">workshops</Link> — they're open to everyone.</span>
          </li>
        </ul>
      </div>
    </motion.div>
  );
}

// ─── Stage indicator ─────────────────────────────────────────────────────────

function StageIndicator({ stage }: { stage: ApplicantStage }) {
  // Map the current stage to a position in the 4-step pipeline
  const steps: { label: string; keys: ApplicantStage[] }[] = [
    { label: 'Applied', keys: ['ApplicationOpen'] },
    { label: 'Review', keys: ['Pending'] },
    { label: 'Interview', keys: ['InvitedToInterview', 'InterviewScheduled', 'PostInterviewPending'] },
    { label: 'Decision', keys: ['Accepted', 'Rejected', 'Waitlisted'] },
  ];

  const currentStepIdx = steps.findIndex(s => s.keys.includes(stage));

  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const isActive = i === currentStepIdx;
        const isPast = i < currentStepIdx;
        return (
          <div key={s.label} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isActive
                ? 'bg-accent-coral text-white'
                : isPast
                  ? 'bg-accent-coral/20 text-accent-coral'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
            }`}>
              {isPast && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-4 h-px ${isPast ? 'bg-accent-coral/40' : 'bg-gray-200 dark:bg-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ApplicantPortal() {
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [loading, setLoading] = useState(true);
  const [currentStage, setCurrentStage] = useState<ApplicantStage>('Pending');
  const [appData, setAppData] = useState<{ id: string; cycleId: string; domainIds: string[] } | null>(null);
  const [interviewData, setInterviewData] = useState<{ id: string; startTime: string; endTime: string; status: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const s = getSession();
    if (!s) { navigate('/login'); return; }
    setSession(s);

    // Fetch application data to determine stage
    fetchWithAuth(`${API_BASE}/api/my-application`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setLoading(false); return; }

        if (data.application) {
          setAppData({ id: data.application.id, cycleId: data.application.applicationCycleId, domainIds: data.application.domainIds });
        }
        if (data.interview) {
          setInterviewData(data.interview);
        }

        // Derive stage
        const app = data.application;
        const interview = data.interview;
        const cycleStatus = data.cycleStatus;

        if (!app) {
          setCurrentStage('ApplicationOpen');
        } else if (app.status === 'Draft') {
          setCurrentStage('ApplicationOpen');
        } else if (app.status === 'Submitted' && cycleStatus === 'Open') {
          setCurrentStage('Pending');
        } else if (app.status === 'Submitted' && !interview && (cycleStatus === 'Closed' || cycleStatus === 'DecisionsReleased')) {
          setCurrentStage('InvitedToInterview');
        } else if (interview && interview.status === 'Scheduled') {
          setCurrentStage('InterviewScheduled');
        } else if (app.status === 'Withdrawn') {
          setCurrentStage('Rejected');
        } else {
          setCurrentStage('PostInterviewPending');
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleBooked = useCallback((interview: { id: string; startTime: string; endTime: string; status: string }) => {
    setInterviewData(interview);
    setCurrentStage('InterviewScheduled');
  }, []);

  const handleCancelled = useCallback(() => {
    setInterviewData(null);
    setCurrentStage('InvitedToInterview');
  }, []);

  const handleRescheduled = useCallback((interview: { id: string; startTime: string; endTime: string; status: string }) => {
    setInterviewData(interview);
  }, []);

  if (loading || !session) return null;

  const { account } = session;
  const displayName = account.firstName
    ? `${account.firstName} ${account.lastName ?? ''}`.trim()
    : account.name ?? account.email;

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      <div className="pt-[72px]">
        {/* Header */}
        <div className="bg-[#E8F4FA] dark:bg-[#061825] px-6 md:px-16 lg:px-24 py-10">
          <motion.div
            className="max-w-3xl mx-auto flex items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {account.picture ? (
              <img src={account.picture} alt={displayName} referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover shadow-md flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-accent-coral flex items-center justify-center text-white text-lg font-bold shadow-md flex-shrink-0">
                {displayName[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="font-heading text-xl font-bold text-nav-primary dark:text-white">
                Welcome, {account.firstName || displayName}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{CYCLE_NAME} Application Portal</p>
            </div>
            <div className="ml-auto hidden sm:block">
              <StageIndicator stage={currentStage} />
            </div>
          </motion.div>
          <div className="sm:hidden max-w-3xl mx-auto mt-4">
            <StageIndicator stage={currentStage} />
          </div>
        </div>

        {/* Content */}
        <div className="px-6 md:px-16 lg:px-24 py-10">
          {currentStage === 'ApplicationOpen' && <ApplicationOpenView />}
          {currentStage === 'Pending' && <PendingView />}
          {currentStage === 'Rejected' && <RejectedView round="first" />}
          {currentStage === 'InvitedToInterview' && <InvitedToInterviewView appData={appData} onBooked={handleBooked} />}
          {currentStage === 'InterviewScheduled' && interviewData && <InterviewScheduledView interview={interviewData} appData={appData} onCancelled={handleCancelled} onRescheduled={handleRescheduled} />}
          {currentStage === 'PostInterviewPending' && <PostInterviewPendingView />}
          {currentStage === 'Accepted' && <AcceptedView />}
          {currentStage === 'Waitlisted' && <WaitlistedView />}
        </div>
      </div>
    </div>
  );
}
