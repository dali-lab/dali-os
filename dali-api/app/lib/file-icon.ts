import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Box,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import type { FileCategory } from "~/lib/file-type";

// Maps a file category to a glyph so uploaded files read at a glance (pdf vs
// image vs video vs …) instead of one generic paperclip everywhere. Returns the
// icon *component*; callers apply their own sizing/color classes.
const CATEGORY_ICON: Record<FileCategory, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileText,
  office: FileText,
  archive: FileArchive,
  model3d: Box,
  other: Paperclip,
};

export function iconForCategory(category: FileCategory): LucideIcon {
  return CATEGORY_ICON[category];
}
