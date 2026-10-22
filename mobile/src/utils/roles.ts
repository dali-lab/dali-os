type TagTone = 'neutral' | 'blue' | 'green' | 'amber' | 'rose' | 'violet';

const ROLE_TONES: Record<string, TagTone> = {
  Core: 'rose',
  'Early builders': 'violet',
  'Fullstack Dev': 'green',
  'Data Dev': 'amber',
  'Product Management': 'violet',
  'UI/UX Design': 'rose',
  'Hiring team': 'blue',
  Staff: 'blue'
};

export function roleTone(role: string): TagTone {
  return ROLE_TONES[role] ?? 'neutral';
}