import { RichEditor } from "./editor/RichEditor";
import {
  resolveFeatures,
  type EditorFeatures,
  type EditorPresetName,
} from "./editor/presets";
import { isEmptyDoc } from "./editor/shared";

// Re-exported for back-compat: many call sites import isEmptyDoc from here.
export { isEmptyDoc };

interface RichTextViewerProps {
  content: unknown;
  className?: string;
  // Render @-mention nodes (page-doc guides).
  enableMentions?: boolean;
  // Render image nodes. Pass the same flag/preset the editor used.
  enableImages?: boolean;
  // Render signing field + variable nodes (read-only). Pass resolved variable
  // values so {{term}} etc. show their value, not the token.
  enableSigningFields?: boolean;
  signingVariables?: Record<string, string>;
  signingValues?: Record<string, unknown>;
  // Declarative capability source, mirrored from the editor. Prefer passing the
  // same `preset`/`features` the RichTextEditor used. Falls back to the booleans.
  preset?: EditorPresetName;
  features?: EditorFeatures;
}

// Thin wrapper over the shared RichEditor core in `bare` (read-only, chromeless)
// mode. The editor and viewer resolve the same features through one code path,
// so the read side can't strip a node the editor stored.
export function RichTextViewer({
  content,
  className,
  enableMentions = false,
  enableImages = false,
  enableSigningFields = false,
  signingVariables,
  signingValues,
  preset,
  features: featuresProp,
}: RichTextViewerProps) {
  const features: EditorFeatures =
    featuresProp ??
    (preset
      ? resolveFeatures(preset)
      : {
          mentions: enableMentions,
          images: enableImages,
          signing: enableSigningFields
            ? { variables: signingVariables, values: signingValues }
            : undefined,
        });

  return <RichEditor bare content={content} features={features} className={className} />;
}
