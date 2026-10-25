export const JOURNEYS_HOME = "/journeys";

export const domainPath = (domain: string) => `${JOURNEYS_HOME}/${domain}`;
export const journeyPath = (domain: string, journeyId: string) => `${domainPath(domain)}/${journeyId}`;
export const editPath = (domain: string, journeyId: string) => `${journeyPath(domain, journeyId)}/edit`;
export const previewPath = (domain: string, journeyId: string) => `${journeyPath(domain, journeyId)}/preview`;
export const modulePath = (domain: string, journeyId: string, moduleId: string) =>
  `${journeyPath(domain, journeyId)}/${moduleId}`;
export const accessPath = (journeyId?: string) =>
  journeyId ? `${JOURNEYS_HOME}/access?journey=${encodeURIComponent(journeyId)}` : `${JOURNEYS_HOME}/access`;
