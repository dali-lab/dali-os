import { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionAccount {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  picture?: string;
  isMember?: boolean;
  dartmouthLinked?: boolean;
  projectCount?: number;
}

interface Course {
  id: string;
  title: string;
  courseType: 'WORKSHOP' | 'MINISERIES';
  term: { name: string };
}

interface Enrollment {
  id: string;
  enrolledAt: string;
  course: Course;
}

type AppStatus = 'IN_PROGRESS' | 'PENDING' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED';

interface Application {
  id: string;
  status: AppStatus;
  rolesApplied: string[];
  submittedAt: string;
  term: { name: string };
  statement?: string;
  portfolioUrl?: string | null;
  resumeUrl?: string | null;
  answers?: Record<string, string | string[]>;
}

interface AppOpenStatus {
  open: boolean;
  termId: string | null;
  termName: string | null;
  inProgressCount: number;
}

interface Question {
  id: string;
  text: string;
  type: 'short_text' | 'long_text' | 'multiple_choice' | 'checkbox' | 'url';
  required: boolean;
  options?: string[];
}

interface FormQuestions {
  common: Question[];
  domains: Record<string, Question[]>;
}

// Maps admin domain labels → Role enum values shown to users
const ROLES: { value: string; label: string; domain: string }[] = [
  { value: 'FULLSTACK',       label: 'Full Stack',    domain: 'Fullstack' },
  { value: 'DATA',            label: 'Data',          domain: 'Data' },
  { value: 'ENGINES',         label: 'Engines',       domain: 'Engines' },
  { value: 'AR_VR',           label: 'AR/VR',         domain: 'AR/VR' },
  { value: 'UI_UX',           label: 'UI/UX',         domain: 'UI/UX' },
  { value: 'VIDEO',           label: 'Video',         domain: 'Video' },
  { value: 'PM',              label: 'PM',            domain: 'PM' },
  { value: 'THREE_D_MODELING',label: '3D Modeling',   domain: '3D Modeling' },
  { value: 'ANIMATION',       label: 'Animation',     domain: 'Animation' },
];

const STATUS_STYLES: Record<AppStatus, string> = {
  IN_PROGRESS:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  PENDING:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ACCEPTED:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  REJECTED:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_LABELS: Record<AppStatus, string> = {
  IN_PROGRESS:  'Draft',
  PENDING:      'Submitted',
  UNDER_REVIEW: 'Under Review',
  ACCEPTED:     'Accepted',
  REJECTED:     'Not Selected',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSession(): { account: SessionAccount; type: string; token: string } | null {
  try {
    const token = sessionStorage.getItem('access_token');
    const type = sessionStorage.getItem('account_type');
    const raw = sessionStorage.getItem('account');
    if (!token || !type || !raw) return null;
    return { account: JSON.parse(raw), type, token };
  } catch {
    return null;
  }
}

// ─── Question renderer ────────────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const base = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d2133] text-sm text-nav-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-accent-coral px-4 py-2';

  if (question.type === 'short_text') {
    return (
      <input
        type="text"
        value={value as string}
        onChange={e => onChange(e.target.value)}
        className={base}
        placeholder="Your answer"
      />
    );
  }
  if (question.type === 'url') {
    return (
      <input
        type="url"
        value={value as string}
        onChange={e => onChange(e.target.value)}
        className={base}
        placeholder="https://"
      />
    );
  }
  if (question.type === 'long_text') {
    return (
      <textarea
        value={value as string}
        onChange={e => onChange(e.target.value)}
        rows={4}
        className={`${base} resize-none`}
        placeholder="Your answer"
      />
    );
  }
  if (question.type === 'multiple_choice') {
    return (
      <div className="space-y-2">
        {(question.options ?? []).map(opt => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={question.id}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="accent-accent-coral"
            />
            <span className="text-sm text-nav-primary dark:text-white">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  if (question.type === 'checkbox') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {(question.options ?? []).map(opt => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              value={opt}
              checked={selected.includes(opt)}
              onChange={e => {
                const next = e.target.checked
                  ? [...selected, opt]
                  : selected.filter(v => v !== opt);
                onChange(next);
              }}
              className="accent-accent-coral"
            />
            <span className="text-sm text-nav-primary dark:text-white">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  return null;
}

// ─── Application form ─────────────────────────────────────────────────────────

function ApplicationForm({
  draft,
  formQuestions,
  onSaved,
  onSubmitted,
}: {
  draft: Application;
  formQuestions: FormQuestions;
  onSaved: (app: Application) => void;
  onSubmitted: (app: Application) => void;
}) {
  const [roles, setRoles] = useState<string[]>(draft.rolesApplied ?? []);
  const [portfolioUrl, setPortfolioUrl] = useState(draft.portfolioUrl ?? '');
  const [resumeUrl, setResumeUrl] = useState(draft.resumeUrl ?? '');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    (draft.answers as Record<string, string | string[]>) ?? {}
  );
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collect questions for currently selected roles
  const roleQuestions = roles.flatMap(roleValue => {
    const role = ROLES.find(r => r.value === roleValue);
    if (!role) return [];
    return (formQuestions.domains[role.domain] ?? []).map(q => ({ ...q, _domain: role.domain }));
  });

  // Deduplicate by question id (same question might appear in two domains)
  const seenIds = new Set<string>();
  const uniqueRoleQuestions = roleQuestions.filter(q => {
    if (seenIds.has(q.id)) return false;
    seenIds.add(q.id);
    return true;
  });

  function setAnswer(id: string, val: string | string[]) {
    setAnswers(prev => ({ ...prev, [id]: val }));
    // Debounced autosave
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave({ answers: { ...answers, [id]: val } }), 1500);
  }

  async function doSave(overrides?: Partial<{ roles: string[]; portfolioUrl: string; resumeUrl: string; answers: Record<string, string | string[]> }>) {
    setSaving(true);
    // Mock save: just call onSaved with updated draft
    const updated: Application = {
      ...draft,
      rolesApplied: overrides?.roles ?? roles,
      portfolioUrl: (overrides?.portfolioUrl ?? portfolioUrl) || null,
      resumeUrl: (overrides?.resumeUrl ?? resumeUrl) || null,
      answers: overrides?.answers ?? answers,
    };
    onSaved(updated);
    setSaving(false);
  }

  async function handleSubmit() {
    setError(null);
    if (roles.length === 0) { setError('Please select at least one role.'); return; }
    const missingRequired = [...formQuestions.common, ...uniqueRoleQuestions].filter(
      q => q.required && !answers[q.id]
    );
    if (missingRequired.length > 0) {
      setError(`Please answer all required questions (${missingRequired.length} remaining).`);
      return;
    }
    setSubmitting(true);
    await doSave();
    const submitted: Application = { ...draft, status: 'PENDING', submittedAt: new Date().toISOString() };
    onSubmitted(submitted);
    setSubmitting(false);
  }

  return (
    <div className="space-y-8">
      {/* Role selector */}
      <div>
        <h3 className="font-heading text-base font-bold text-nav-primary dark:text-white mb-1">
          Roles <span className="text-accent-coral">*</span>
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Select every role you'd like to be considered for.</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map(r => (
            <button
              key={r.value}
              onClick={() => {
                const next = roles.includes(r.value)
                  ? roles.filter(v => v !== r.value)
                  : [...roles, r.value];
                setRoles(next);
                if (saveTimer.current) clearTimeout(saveTimer.current);
                saveTimer.current = setTimeout(() => doSave({ roles: next }), 1500);
              }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                roles.includes(r.value)
                  ? 'bg-accent-coral text-white border-accent-coral'
                  : 'bg-white dark:bg-[#0d2133] text-nav-primary dark:text-white border-gray-200 dark:border-gray-700 hover:border-accent-coral'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-nav-primary dark:text-white mb-1">Portfolio URL</label>
          <input
            type="url"
            value={portfolioUrl}
            onChange={e => { setPortfolioUrl(e.target.value); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => doSave({ portfolioUrl: e.target.value }), 1500); }}
            placeholder="https://yourportfolio.com"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d2133] text-sm text-nav-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-accent-coral px-4 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-nav-primary dark:text-white mb-1">Resume URL</label>
          <input
            type="url"
            value={resumeUrl}
            onChange={e => { setResumeUrl(e.target.value); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => doSave({ resumeUrl: e.target.value }), 1500); }}
            placeholder="https://drive.google.com/..."
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d2133] text-sm text-nav-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-accent-coral px-4 py-2"
          />
        </div>
      </div>

      {/* Common questions */}
      {formQuestions.common.length > 0 && (
        <div className="space-y-5">
          <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider">General Questions</h3>
          {formQuestions.common.map(q => (
            <div key={q.id}>
              <label className="block text-sm font-semibold text-nav-primary dark:text-white mb-1">
                {q.text}{q.required && <span className="text-accent-coral ml-0.5">*</span>}
              </label>
              <QuestionField
                question={q}
                value={answers[q.id] ?? (q.type === 'checkbox' ? [] : '')}
                onChange={val => setAnswer(q.id, val)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Role-specific questions */}
      {uniqueRoleQuestions.length > 0 && (
        <div className="space-y-5">
          <h3 className="font-heading text-sm font-bold text-nav-primary dark:text-white uppercase tracking-wider">
            Role-Specific Questions
          </h3>
          {uniqueRoleQuestions.map(q => (
            <div key={q.id}>
              <label className="block text-sm font-semibold text-nav-primary dark:text-white mb-1">
                {q.text}{q.required && <span className="text-accent-coral ml-0.5">*</span>}
              </label>
              <QuestionField
                question={q}
                value={answers[q.id] ?? (q.type === 'checkbox' ? [] : '')}
                onChange={val => setAnswer(q.id, val)}
              />
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => doSave()}
          disabled={saving}
          className="px-5 py-2.5 rounded-full border-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || roles.length === 0}
          className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Application'}
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
          {saving ? 'Saving…' : 'Auto-saved'}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Account() {
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [linking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');

  const [appOpenStatus, setAppOpenStatus] = useState<AppOpenStatus | null>(null);
  const [formQuestions, setFormQuestions] = useState<FormQuestions>({ common: [], domains: {} });
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    const s = getSession();
    if (!s) { navigate('/login'); return; }
    setSession(s);
    setAppOpenStatus({ open: true, termId: '24F', termName: 'Fall 2024', inProgressCount: 0 });
    setFormQuestions({ common: [], domains: {} });
    setEnrollments([]);
    setApplications([]);
    setLoadingData(false);
  }, []);

  const handleLinkMember = () => {
    if (!linkEmail.endsWith('@dartmouth.edu')) {
      setLinkError('Please enter your @dartmouth.edu email.');
      return;
    }
    const rawAccount = sessionStorage.getItem('account');
    if (rawAccount) {
      const updated = { ...JSON.parse(rawAccount), dartmouthLinked: true };
      sessionStorage.setItem('account', JSON.stringify(updated));
      setSession(getSession());
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('account_type');
    sessionStorage.removeItem('account');
    navigate('/');
  };

  function handleStartApplication() {
    const s = getSession();
    if (!s || !appOpenStatus?.termId) return;
    const newDraft: Application = {
      id: 'draft-1',
      status: 'IN_PROGRESS',
      rolesApplied: [],
      submittedAt: '',
      term: { name: appOpenStatus.termName ?? '' },
      answers: {},
      portfolioUrl: null,
      resumeUrl: null,
    };
    setApplications(prev => {
      const exists = prev.find(a => a.id === newDraft.id);
      return exists ? prev : [newDraft, ...prev];
    });
    setActiveDraftId(newDraft.id);
  }

  if (!session) return null;

  const { account, type } = session;
  const displayName = account.firstName
    ? `${account.firstName} ${account.lastName ?? ''}`.trim()
    : account.name ?? account.email;

  const canApply = type === 'dartmouth' || type === 'member';
  const draft = applications.find(a => a.id === activeDraftId) ?? null;
  const submitted = applications.filter(a => a.status !== 'IN_PROGRESS');
  const hasDraft = applications.some(a => a.status === 'IN_PROGRESS');
  const hasActiveSubmission = applications.some(a => a.status === 'PENDING' || a.status === 'UNDER_REVIEW');

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      <div className="pt-[72px]">
        {/* Profile header */}
        <div className="bg-[#E8F4FA] dark:bg-[#061825] px-6 md:px-16 lg:px-24 py-12">
          <motion.div
            className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center sm:items-start gap-6"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            {account.picture ? (
              <img src={account.picture} alt={displayName} referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-full object-cover shadow-md flex-shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-accent-coral flex items-center justify-center text-white text-2xl font-bold shadow-md flex-shrink-0">
                {displayName[0].toUpperCase()}
              </div>
            )}
            <div className="text-center sm:text-left">
              <h1 className="font-heading text-3xl font-bold text-nav-primary dark:text-white mb-1">{displayName}</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">{account.email}</p>
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                <span className={`text-xs px-3 py-1 rounded-full font-semibold tracking-wider ${
                  type === 'member' || (type === 'dartmouth' && account.isMember)
                    ? 'bg-accent-coral text-white'
                    : 'bg-white dark:bg-[#0d2133] text-nav-primary dark:text-white'
                }`}>
                  {type === 'member' ? 'DALI Member' : type === 'dartmouth' ? (account.isMember ? 'DALI Member' : 'Dartmouth Student') : 'Partner'}
                </span>
                {hasDraft && (
                  <span className="text-xs px-3 py-1 rounded-full font-semibold tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    Application in progress
                  </span>
                )}
                {hasActiveSubmission && !hasDraft && (
                  <span className="text-xs px-3 py-1 rounded-full font-semibold tracking-wider bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                    Application submitted
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        <div className="max-w-4xl mx-auto px-6 md:px-16 lg:px-24 py-10 space-y-10">

          {/* Link DALI profile prompt */}
          {type === 'member' && account.isMember && !account.dartmouthLinked && (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              className="px-5 py-5 rounded-2xl border-2 border-accent-coral/40 bg-accent-coral/5 dark:bg-accent-coral/10"
            >
              <h2 className="font-heading text-base font-bold text-nav-primary dark:text-white mb-1">Link your DALI profile</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Connect your account to your student record to unlock your full member dashboard.
              </p>
              <input type="email" placeholder="your.name@dartmouth.edu" value={linkEmail}
                onChange={e => setLinkEmail(e.target.value)}
                className="w-full mb-3 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d2133] text-sm text-nav-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-accent-coral"
              />
              {linkError && <p className="text-sm text-red-500 mb-3">{linkError}</p>}
              <button onClick={handleLinkMember} disabled={linking || !linkEmail}
                className="px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold font-heading tracking-wider hover:bg-opacity-90 transition disabled:opacity-50"
              >
                {linking ? 'Linking…' : 'Link profile'}
              </button>
            </motion.section>
          )}

          {/* ── Application section ── */}
          {canApply && (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading text-lg font-bold text-nav-primary dark:text-white">Application</h2>
                {appOpenStatus?.open && !hasDraft && !hasActiveSubmission && (
                  <button onClick={handleStartApplication}
                    className="text-sm font-semibold text-accent-coral hover:underline"
                  >
                    Start application →
                  </button>
                )}
              </div>

              {loadingData ? (
                <div className="h-24 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133] animate-pulse" />
              ) : !appOpenStatus?.open && !hasDraft && submitted.length === 0 ? (
                /* Applications closed, nothing to show */
                <div className="px-4 py-6 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133] text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Applications are currently closed.</p>
                  <Link to="/apply" className="text-sm font-semibold text-accent-coral hover:underline">
                    Learn more about joining DALI →
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Draft / active form */}
                  {hasDraft && draft && (
                    <div className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-[#F0F7FF] dark:bg-[#061825] overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-blue-100 dark:border-blue-900/60">
                        <div>
                          <span className="font-heading text-sm font-bold text-nav-primary dark:text-white">
                            {appOpenStatus?.termName} Application
                          </span>
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold">Draft</span>
                        </div>
                      </div>
                      <div className="px-5 py-6">
                        <ApplicationForm
                          draft={draft}
                          formQuestions={formQuestions}

                          onSaved={updated => setApplications(prev => prev.map(a => a.id === updated.id ? updated : a))}
                          onSubmitted={updated => {
                            setApplications(prev => prev.map(a => a.id === updated.id ? updated : a));
                            setActiveDraftId(null);
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Open but no draft yet */}
                  {appOpenStatus?.open && !hasDraft && !hasActiveSubmission && submitted.length === 0 && (
                    <div className="px-4 py-6 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133] text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No application started yet.</p>
                      <button onClick={handleStartApplication}
                        className="text-sm font-semibold text-accent-coral hover:underline"
                      >
                        Start your application →
                      </button>
                    </div>
                  )}

                  {/* Past/submitted applications */}
                  {submitted.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {submitted.map(app => (
                        <div key={app.id} className="px-4 py-4 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm text-nav-primary dark:text-white">{app.term.name}</span>
                            <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${STATUS_STYLES[app.status]}`}>
                              {STATUS_LABELS[app.status]}
                            </span>
                          </div>
                          {app.rolesApplied.length > 0 && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Roles: {app.rolesApplied.map(r => ROLES.find(x => x.value === r)?.label ?? r).join(', ')}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Submitted {new Date(app.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.section>
          )}

          {/* Enrolled courses */}
          {canApply && (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <h2 className="font-heading text-lg font-bold text-nav-primary dark:text-white mb-4">Enrolled Courses</h2>
              {loadingData ? (
                <div className="h-16 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133] animate-pulse" />
              ) : enrollments.length === 0 ? (
                <div className="px-4 py-6 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133] text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No courses enrolled yet.</p>
                  <Link to="/education" className="text-sm font-semibold text-accent-coral hover:underline">
                    Browse DALI courses →
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {enrollments.map(e => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-4 rounded-xl bg-[#E8F4FA] dark:bg-[#0d2133]">
                      <div>
                        <p className="font-semibold text-sm text-nav-primary dark:text-white">{e.course.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{e.course.term.name}</p>
                      </div>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-white dark:bg-[#1a3347] text-gray-600 dark:text-gray-300 font-medium">
                        {e.course.courseType === 'WORKSHOP' ? 'Workshop' : 'Mini-series'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>
          )}

          {/* Sign out */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4 }}
          >
            <button onClick={handleLogout}
              className="w-full py-3 rounded-full border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold font-heading tracking-wider hover:border-accent-coral hover:text-accent-coral transition"
            >
              Sign out
            </button>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
