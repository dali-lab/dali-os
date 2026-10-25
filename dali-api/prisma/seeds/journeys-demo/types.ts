import type { JourneyContent, JourneyModule, LessonPage, Slide } from "../../../app/journeys/lib/types.js";
import type { StudioLab } from "../../../app/journeys/lib/studio-types.js";

// The sample journeys are written in HTML, the way the original prototype
// stored them; the seed converts that HTML to BlockNote documents.
type SeedPage = Omit<LessonPage, "content"> & { content: string };
type SeedSlide = Omit<Slide, "body"> & { body?: string };
/** Document templates are HTML here too. */
export type SeedStudioLab = Omit<StudioLab, "document"> & { document?: { template: string } };
type SeedModule = Omit<JourneyModule, "pages" | "slides" | "studio"> & { pages: SeedPage[]; slides?: SeedSlide[]; studio?: SeedStudioLab };

export type SeedJourney = Omit<JourneyContent, "modules"> & { id: string; modules: SeedModule[] };
