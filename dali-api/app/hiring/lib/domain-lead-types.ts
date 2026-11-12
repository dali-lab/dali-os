export type DomainRoundSummary = {
  id: string;
  label: string;
  isFinal: boolean;
  leadsToInterviews: boolean;
  /** This domain's applicants who qualify for the round's board now. */
  count: number;
};
