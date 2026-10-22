import type { EventCategory, Rsvp } from '../types/calendar';

export const CATEGORY_META: Record<EventCategory, {label: string;bar: string;}> = {
  dali: { label: 'DALI', bar: 'bg-teal' },
  interview: { label: 'Interview', bar: 'bg-navy' },
  class: { label: 'Class', bar: 'bg-yellow' },
  personal: { label: 'Personal', bar: 'bg-coral' }
};

export const RSVP_LABEL: Record<Rsvp, string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Declined',
  needs_action: 'RSVP needed'
};