import { useState, useEffect } from "react";
import { CheckCircle } from "lucide-react";

interface InterviewConfig {
  id?: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  dayStartHour: number;
  dayEndHour: number;
  interviewStartDate: string;
  interviewEndDate: string;
  timezone: string;
}

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60];
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30];
const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 6); // 6 AM to 8 PM

function formatHour(h: number) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export function InterviewConfigTab({ cycleId }: { cycleId: string }) {
  const [config, setConfig] = useState<InterviewConfig>({
    slotDurationMinutes: 30,
    bufferMinutes: 15,
    dayStartHour: 9,
    dayEndHour: 18,
    interviewStartDate: '',
    interviewEndDate: '',
    timezone: 'America/New_York',
  });
  const [configSaved, setConfigSaved] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/cycles/${cycleId}/interview-config`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setConfig({
            ...data,
            interviewStartDate: data.interviewStartDate?.slice(0, 10) ?? '',
            interviewEndDate: data.interviewEndDate?.slice(0, 10) ?? '',
          });
        }
      })
      .catch(() => {});
  }, [cycleId]);

  async function saveConfig() {
    setConfigSaving(true);
    try {
      const res = await fetch(`/api/cycles/${cycleId}/interview-config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setConfigSaved(true);
        setTimeout(() => setConfigSaved(false), 2000);
      }
    } finally {
      setConfigSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Slot Duration</label>
            <select
              value={config.slotDurationMinutes}
              onChange={e => setConfig(c => ({ ...c, slotDurationMinutes: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Buffer Between Interviews</label>
            <select
              value={config.bufferMinutes}
              onChange={e => setConfig(c => ({ ...c, bufferMinutes: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {BUFFER_OPTIONS.map(b => <option key={b} value={b}>{b} minutes</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Day Start</label>
            <select
              value={config.dayStartHour}
              onChange={e => setConfig(c => ({ ...c, dayStartHour: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Day End</label>
            <select
              value={config.dayEndHour}
              onChange={e => setConfig(c => ({ ...c, dayEndHour: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Interview Start Date</label>
            <input
              type="date"
              value={config.interviewStartDate}
              onChange={e => setConfig(c => ({ ...c, interviewStartDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground/80 mb-1">Interview End Date</label>
            <input
              type="date"
              value={config.interviewEndDate}
              onChange={e => setConfig(c => ({ ...c, interviewEndDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={saveConfig}
            disabled={configSaving || !config.interviewStartDate || !config.interviewEndDate}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            {configSaving ? 'Saving...' : configSaved ? 'Saved!' : 'Save Configuration'}
          </button>
          {configSaved && <CheckCircle className="w-4 h-4 text-green-500" />}
        </div>
      </div>
    </div>
  );
}
