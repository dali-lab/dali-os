import type { PrismaClient } from "../../app/generated/prisma/client.js";

// Demo data wide enough that the Partner Relations hub's charts, pipeline,
// contacts, and term ribbon all render against real rows — not the component
// fallbacks. Idempotent (upserts + deterministic ids) so re-seeding is safe.
//
// Shape:
//   • 6 terms spanning past → current → future (keeps 26S from main seed
//     as the "current" term by giving the others fixed dates).
//   • 7 extra Domains (on top of the 3 the main seed already creates) so
//     the "dominant domain" pie slices visibly differ.
//   • 10 PartnerOrgs with distinct faviconChars (letters + emoji) so the
//     Contacts rail and ProjectDrawer tiles have identity at a glance.
//   • 16 Projects with varied partnerships and 1–3 ProjectTerm placements.
//   • 2–3 ProjectRoleRequests per project per term, varied so each project
//     has a clear "dominant" domain and the aggregate pie has 6+ slices.
//   • 7 PartnerApplications spread across the pipeline statuses used by the
//     kanban (Submitted, UnderReview, Meeting, OnHold, Accepted, Rejected,
//     Inquiry) so every column has at least one card.

export async function seedPartnerRelationsHub(prisma: PrismaClient): Promise<void> {
  // ── Terms ──────────────────────────────────────────────────────────────────
  // 26S is seeded with "now"-bracketed dates by the main seed; we leave it
  // alone and add neighbors with fixed dates on either side.
  const extraTerms: {
    code: string;
    year: number;
    season: "W" | "S" | "X" | "F";
    sortKey: number;
    startDate: string;
    endDate: string;
  }[] = [
    { code: "25F", year: 2025, season: "F", sortKey: 20254, startDate: "2025-09-15", endDate: "2025-12-05" },
    { code: "26W", year: 2026, season: "W", sortKey: 20261, startDate: "2026-01-05", endDate: "2026-03-10" },
    { code: "26X", year: 2026, season: "X", sortKey: 20263, startDate: "2026-06-15", endDate: "2026-08-20" },
    { code: "26F", year: 2026, season: "F", sortKey: 20264, startDate: "2026-09-15", endDate: "2026-12-05" },
    { code: "27W", year: 2027, season: "W", sortKey: 20271, startDate: "2027-01-05", endDate: "2027-03-10" },
    { code: "27S", year: 2027, season: "S", sortKey: 20272, startDate: "2027-03-28", endDate: "2027-06-05" },
  ];
  for (const t of extraTerms) {
    await prisma.term.upsert({
      where: { code: t.code },
      update: {
        year: t.year,
        season: t.season,
        sortKey: t.sortKey,
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
      },
      create: {
        code: t.code,
        year: t.year,
        season: t.season,
        sortKey: t.sortKey,
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
      },
    });
  }

  // ── Extra Domains ──────────────────────────────────────────────────────────
  // Main seed owns Design (UIUX), Engineering (Fullstack), Product (PM).
  // Adding these gives the pie chart room to breathe.
  const extraDomains = [
    { id: "domain-data",      code: "Data",      name: "Data",         displayName: "Data" },
    { id: "domain-arvr",      code: "ARVR",      name: "AR/VR",        displayName: "AR / VR" },
    { id: "domain-animation", code: "Animation", name: "Animation",    displayName: "Animation" },
    { id: "domain-graphics",  code: "Graphics",  name: "Graphics",     displayName: "Graphics" },
    { id: "domain-3d",        code: "3D",        name: "3D Modeling",  displayName: "3D Modeling" },
    { id: "domain-games",     code: "Games",     name: "Game Dev",     displayName: "Game Dev" },
    { id: "domain-hardware",  code: "Hardware",  name: "Hardware",     displayName: "Hardware" },
  ];
  for (const d of extraDomains) {
    await prisma.domain.upsert({
      where: { code: d.code },
      update: { name: d.name, displayName: d.displayName },
      create: { id: d.id, code: d.code, name: d.name, displayName: d.displayName },
    });
  }

  // Pull domain ids now (we'll reference them in role requests by id).
  const [uiux, fullstack, pm, data, arvr, animation, graphics, threeD, games, hardware] = await Promise.all([
    prisma.domain.findUnique({ where: { code: "UIUX" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Fullstack" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "PM" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Data" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "ARVR" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Animation" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Graphics" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "3D" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Games" }, select: { id: true } }),
    prisma.domain.findUnique({ where: { code: "Hardware" }, select: { id: true } }),
  ]);

  if (!uiux || !fullstack || !pm || !data || !arvr || !animation || !graphics || !threeD || !games || !hardware) {
    throw new Error("partner-relations-hub seed: domain upsert produced a null id");
  }

  // ── Partner orgs ───────────────────────────────────────────────────────────
  const partnerSeeds = [
    { id: "prhub-ultrasound",  name: "Ultrasound Lab",            faviconChar: "🩻" },
    { id: "prhub-aipa",        name: "AI Patient Actor",          faviconChar: "🩺" },
    { id: "prhub-twigby",      name: "Twigby",                    faviconChar: "📱" },
    { id: "prhub-deserto",     name: "Deserto",                   faviconChar: "🌵" },
    { id: "prhub-baltimore",   name: "Connect Baltimore",         faviconChar: "🌆" },
    { id: "prhub-bric",        name: "BRIC Installations",        faviconChar: "🎮" },
    { id: "prhub-echo",        name: "ECHO · Death Wishes",       faviconChar: "🕊" },
    { id: "prhub-evergreen",   name: "Evergreen",                 faviconChar: "🌲" },
    { id: "prhub-smartmic",    name: "SmartMic",                  faviconChar: "🎤" },
    { id: "prhub-rcd",         name: "Research Computing",        faviconChar: "📊" },
    { id: "prhub-plasmid",     name: "Plasmidsaurus",             faviconChar: "🧬" },
    { id: "prhub-orchard",     name: "Orchard Robotics",          faviconChar: "🍎" },
    { id: "prhub-power",       name: "Power Clinical Trials",     faviconChar: "💊" },
    { id: "prhub-range",       name: "Range Bio",                 faviconChar: "🔬" },
    { id: "prhub-knowgraph",   name: "Knowledge Graph (Prof. Yan)", faviconChar: "🧠" },
    { id: "prhub-tours",       name: "Custom Tours",              faviconChar: "🗺" },
  ];
  for (const p of partnerSeeds) {
    await prisma.partnerOrg.upsert({
      where: { id: p.id },
      update: { name: p.name, faviconChar: p.faviconChar, isIndividual: false },
      create: { id: p.id, name: p.name, faviconChar: p.faviconChar, isIndividual: false },
    });
  }

  // ── Projects + role mix ────────────────────────────────────────────────────
  // Each project gets 1–3 terms it runs in, and a role mix in which the first
  // domain is intentionally dominant (highest slots). The hub derives the pie
  // chart's "dominant domain" from the highest-slot domain across all terms,
  // so varying the lead domain is what gives the chart its slices.
  type RoleMix = { domainId: string; slots: number };
  type ProjectSeed = {
    id: string;
    name: string;
    iconEmoji: string | null;
    status: "Active" | "Paused" | "Archived";
    partnerIds: string[];
    terms: string[]; // codes
    roles: RoleMix[]; // applied to each of the terms
  };

  const projectSeeds: ProjectSeed[] = [
    { id: "prhub-proj-ultrasound", name: "Ultrasound AR", iconEmoji: "lucide:Monitor", status: "Active",
      partnerIds: ["prhub-ultrasound"], terms: ["26S", "26X", "26F"],
      roles: [{ domainId: arvr.id, slots: 3 }, { domainId: fullstack.id, slots: 2 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-aipa", name: "AI Patient Actor", iconEmoji: "lucide:Bot", status: "Active",
      partnerIds: ["prhub-aipa"], terms: ["26S", "26X"],
      roles: [{ domainId: data.id, slots: 3 }, { domainId: fullstack.id, slots: 2 }, { domainId: uiux.id, slots: 1 }] },

    { id: "prhub-proj-twigby", name: "Twigby", iconEmoji: "lucide:Smartphone", status: "Active",
      partnerIds: ["prhub-twigby"], terms: ["26S", "26X", "26F", "27W"],
      roles: [{ domainId: fullstack.id, slots: 3 }, { domainId: uiux.id, slots: 2 }, { domainId: animation.id, slots: 1 }] },

    { id: "prhub-proj-deserto", name: "Deserto", iconEmoji: "lucide:Sprout", status: "Active",
      partnerIds: ["prhub-deserto"], terms: ["26S", "26F"],
      roles: [{ domainId: uiux.id, slots: 3 }, { domainId: fullstack.id, slots: 2 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-baltimore", name: "Connect Baltimore", iconEmoji: "lucide:Building2", status: "Active",
      partnerIds: ["prhub-baltimore"], terms: ["26X", "26F"],
      roles: [{ domainId: fullstack.id, slots: 3 }, { domainId: uiux.id, slots: 2 }, { domainId: data.id, slots: 1 }] },

    { id: "prhub-proj-bric", name: "BRIC Installations", iconEmoji: "lucide:Gamepad2", status: "Active",
      partnerIds: ["prhub-bric"], terms: ["26S", "26X"],
      roles: [{ domainId: games.id, slots: 4 }, { domainId: arvr.id, slots: 2 }, { domainId: graphics.id, slots: 1 }] },

    { id: "prhub-proj-echo", name: "Death Wishes (ECHO)", iconEmoji: "lucide:Heart", status: "Paused",
      partnerIds: ["prhub-echo"], terms: ["27W"],
      roles: [{ domainId: uiux.id, slots: 2 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-evergreen", name: "Evergreen", iconEmoji: "lucide:Leaf", status: "Active",
      partnerIds: ["prhub-evergreen"], terms: ["25F", "26W", "26S", "26X", "26F"],
      roles: [{ domainId: uiux.id, slots: 3 }, { domainId: fullstack.id, slots: 2 }, { domainId: arvr.id, slots: 1 }, { domainId: data.id, slots: 1 }] },

    { id: "prhub-proj-smartmic", name: "SmartMic", iconEmoji: "lucide:Music", status: "Active",
      partnerIds: ["prhub-smartmic"], terms: ["26S", "26X", "26F"],
      roles: [{ domainId: hardware.id, slots: 4 }, { domainId: fullstack.id, slots: 1 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-rcd", name: "Research Computing Dashboard", iconEmoji: "lucide:BarChart3", status: "Active",
      partnerIds: ["prhub-rcd"], terms: ["26F", "27W"],
      roles: [{ domainId: data.id, slots: 3 }, { domainId: fullstack.id, slots: 2 }, { domainId: uiux.id, slots: 1 }] },

    { id: "prhub-proj-plasmid", name: "Plasmidsaurus Sequencing Viz", iconEmoji: "lucide:FlaskConical", status: "Active",
      partnerIds: ["prhub-plasmid"], terms: ["26X", "26F"],
      roles: [{ domainId: data.id, slots: 3 }, { domainId: graphics.id, slots: 2 }, { domainId: fullstack.id, slots: 1 }] },

    { id: "prhub-proj-orchard", name: "Orchard Robotics", iconEmoji: "lucide:Bot", status: "Active",
      partnerIds: ["prhub-orchard"], terms: ["26F", "27W"],
      roles: [{ domainId: hardware.id, slots: 3 }, { domainId: data.id, slots: 2 }, { domainId: fullstack.id, slots: 1 }] },

    { id: "prhub-proj-power", name: "Power Clinical Trials", iconEmoji: "lucide:FlaskConical", status: "Active",
      partnerIds: ["prhub-power"], terms: ["26F"],
      roles: [{ domainId: fullstack.id, slots: 3 }, { domainId: uiux.id, slots: 2 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-range", name: "Range Bio Proteomics", iconEmoji: "lucide:Microscope", status: "Active",
      partnerIds: ["prhub-range"], terms: ["26F", "27W"],
      roles: [{ domainId: data.id, slots: 3 }, { domainId: graphics.id, slots: 2 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-knowgraph", name: "Knowledge Graph Assessment", iconEmoji: "lucide:Brain", status: "Active",
      partnerIds: ["prhub-knowgraph"], terms: ["26X", "26F", "27W"],
      roles: [{ domainId: data.id, slots: 2 }, { domainId: fullstack.id, slots: 2 }, { domainId: uiux.id, slots: 1 }] },

    { id: "prhub-proj-tours", name: "Custom Tours", iconEmoji: "lucide:Map", status: "Paused",
      partnerIds: ["prhub-tours"], terms: ["25F", "26W"],
      roles: [{ domainId: uiux.id, slots: 3 }, { domainId: fullstack.id, slots: 3 }, { domainId: pm.id, slots: 1 }] },

    { id: "prhub-proj-battlefield", name: "3D Battlefield", iconEmoji: "lucide:Compass", status: "Active",
      partnerIds: ["prhub-tours"], terms: ["26F"],
      roles: [{ domainId: threeD.id, slots: 3 }, { domainId: animation.id, slots: 2 }, { domainId: fullstack.id, slots: 1 }] },
  ];

  // Resolve term codes → ids once.
  const termRows = await prisma.term.findMany({ select: { id: true, code: true } });
  const termByCode = new Map(termRows.map((t) => [t.code, t.id]));

  // Clear role requests for the terms we're about to re-seed, so slot counts
  // don't double on re-run. Only touch rows this seed owns (project ids with
  // the `prhub-proj-` prefix).
  await prisma.projectRoleRequest.deleteMany({
    where: { projectId: { startsWith: "prhub-proj-" } },
  });
  await prisma.projectTerm.deleteMany({
    where: { projectId: { startsWith: "prhub-proj-" } },
  });

  for (const p of projectSeeds) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name, iconEmoji: p.iconEmoji, status: p.status, termCount: p.terms.length },
      create: { id: p.id, name: p.name, iconEmoji: p.iconEmoji, status: p.status, termCount: p.terms.length },
    });

    for (const partnerOrgId of p.partnerIds) {
      await prisma.projectPartner.upsert({
        where: { projectId_partnerOrgId: { projectId: p.id, partnerOrgId } },
        update: {},
        create: { projectId: p.id, partnerOrgId },
      });
    }

    for (const code of p.terms) {
      const termId = termByCode.get(code);
      if (!termId) continue;
      await prisma.projectTerm.create({
        data: { projectId: p.id, termId },
      });
      for (const r of p.roles) {
        await prisma.projectRoleRequest.create({
          data: {
            projectId: p.id,
            termId,
            domainId: r.domainId,
            level: "P1",
            slots: r.slots,
          },
        });
      }
    }
  }

  // ── Partner applications (pipeline) ────────────────────────────────────────
  // Spread across every pipeline column so the kanban isn't lopsided. Status
  // values are the ones the Pipeline component collapses into its 4 lanes.
  type AppSeed = {
    id: string;
    partnerOrgId: string;
    title: string;
    summary: string;
    status: "Submitted" | "Inquiry" | "UnderReview" | "Meeting" | "OnHold" | "Accepted" | "Rejected";
    rejectionStage?: "Intake" | "Interview" | "Scoping" | "Funding" | "Other";
    rejectionRationale?: string;
  };
  const appSeeds: AppSeed[] = [
    { id: "prhub-app-plasmid", partnerOrgId: "prhub-plasmid",
      title: "Sequencing-result scientific visualization",
      summary: "Full-stack + scientific viz for sequencing outputs.", status: "Submitted" },
    { id: "prhub-app-range", partnerOrgId: "prhub-range",
      title: "Translational proteomics data science",
      summary: "Data science + scientific visualization for proteomics.", status: "Inquiry" },
    { id: "prhub-app-orchard", partnerOrgId: "prhub-orchard",
      title: "Hardware/sensing + ML visualization",
      summary: "ML/data viz layer over the Orchard sensing stack.", status: "UnderReview" },
    { id: "prhub-app-power", partnerOrgId: "prhub-power",
      title: "Clinical trial access · full-stack + UX",
      summary: "Patient-matching flows and clinician dashboards.", status: "Meeting" },
    { id: "prhub-app-knowgraph", partnerOrgId: "prhub-knowgraph",
      title: "Knowledge graph assessment platform",
      summary: "Textbook → concept-level adaptive assessment.", status: "OnHold" },
    { id: "prhub-app-rcd", partnerOrgId: "prhub-rcd",
      title: "Research computing dashboard",
      summary: "Internal dashboard for Research Computing ops.", status: "Accepted" },
    { id: "prhub-app-fsh", partnerOrgId: "prhub-plasmid",
      title: "FSH Technologies hardware tooling",
      summary: "Didn't fit DALI's team shape; recommended Thayer capstone.",
      status: "Rejected", rejectionStage: "Intake",
      rejectionRationale: "Scope more suited to a professional engineering firm; declined at intake." },
  ];

  for (const a of appSeeds) {
    // Account-first: every PartnerApplication is owned by a PartnerContact
    // (applicantContactId is required). Seed one per application with a
    // deterministic email so re-seeding stays idempotent.
    const applicant = await prisma.partnerContact.upsert({
      where: { email: `${a.id}@prhub.seed.dali` },
      update: { name: `${a.title} contact` },
      create: { email: `${a.id}@prhub.seed.dali`, name: `${a.title} contact` },
      select: { id: true },
    });
    await prisma.partnerApplication.upsert({
      where: { id: a.id },
      update: {
        partnerOrgId: a.partnerOrgId,
        title: a.title,
        summary: a.summary,
        status: a.status,
        rejectionStageAt: a.rejectionStage ?? null,
        rejectionRationale: a.rejectionRationale ?? null,
      },
      create: {
        id: a.id,
        partnerOrgId: a.partnerOrgId,
        applicantContactId: applicant.id,
        title: a.title,
        summary: a.summary,
        status: a.status,
        rejectionStageAt: a.rejectionStage ?? null,
        rejectionRationale: a.rejectionRationale ?? null,
      },
    });
  }

  console.log(
    `  [partner-relations-hub] ${extraTerms.length} terms, ${extraDomains.length} domains, ${partnerSeeds.length} partner orgs, ${projectSeeds.length} projects, ${appSeeds.length} partner applications`,
  );
}
