import { RichEditor } from "./editor/RichEditor";
import {
  resolveFeatures,
  type EditorFeatures,
  type EditorPresetName,
} from "./editor/presets";

// Re-exported for back-compat: the link-safety helper (and its unit test) live
// with the shared toolbar now.
export { isSafeLinkUrl } from "./editor/toolbar";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // Opt in to @-mention typeahead (page-doc guides). Off by default so other
  // editor surfaces (mentorship notes, form builder) don't fire member lookups.
  enableMentions?: boolean;
  // Show the persistent full formatting bar (density "full"). Off by default —
  // other surfaces keep the compact selection-only bar (link + image button).
  richToolbar?: boolean;
  // Opt in to pasting/dropping images, uploaded to S3 and inserted by URL.
  // RichTextViewer needs the matching flag, or saved images won't render.
  enableImages?: boolean;
  // Opt in to placeable signing fields + merge variables (document-signing
  // authoring). The toolbar gains an "Insert" group for the given roles.
  signingRoles?: string[];
  // Declarative capability source (preferred over the booleans above). `preset`
  // names a bundle; `features` is the raw shape (escape hatch). Either drives
  // this editor AND its RichTextViewer through the same resolver, so parity
  // can't drift. When neither is set, the legacy booleans are used.
  preset?: EditorPresetName;
  features?: EditorFeatures;
}

// Thin wrapper over the shared RichEditor core (editable mode). Read views use
// RichTextViewer, which wraps the same core in `bare` mode.
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write a description…",
  disabled = false,
  className,
  enableMentions = false,
  richToolbar = false,
  enableImages = false,
  signingRoles,
  preset,
  features: featuresProp,
}: RichTextEditorProps) {
  const features: EditorFeatures =
    featuresProp ??
    (preset
      ? resolveFeatures(preset)
      : {
          mentions: enableMentions,
          images: enableImages,
          signing: signingRoles ? { roles: signingRoles } : undefined,
        });

  return (
    <RichEditor
      content={value}
      features={features}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      density={richToolbar ? "full" : "compact"}
    />
  );
}
