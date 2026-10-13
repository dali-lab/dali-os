import type { FolderType } from "~/generated/prisma/client";

export type ReceiverFolderType = Exclude<FolderType, "Root">;
export type ReceiverProcessType = "Core" | "HiringCycle" | "Mentorship" | "Project" | "Lab";

export const RECEIVER_LABELS: Record<ReceiverFolderType, string> = {
  Meetings: "Meeting notebooks",
  HiringForms: "Hiring forms",
  ApplicationTemplates: "Application templates",
  Agreements: "Agreements",
  EducationTemplates: "Education templates",
  CertificateBackgrounds: "Certificate backgrounds",
  MentorNotebooks: "Mentor notebooks",
};

export const RECEIVER_SLOTS: Record<ReceiverProcessType, readonly ReceiverFolderType[]> = {
  Core: ["Meetings", "Agreements", "EducationTemplates", "CertificateBackgrounds"],
  HiringCycle: ["HiringForms", "ApplicationTemplates"],
  Mentorship: ["MentorNotebooks"],
  Project: ["Meetings"],
  Lab: ["Meetings"],
};
