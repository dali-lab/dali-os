// Env half of the AI gate: whether the server has an AI provider key,
// published by root.tsx as a meta tag (same CSP-safe pattern as collab-url).
// Surfaces opt in per-mount via the DocEditor aiEnabled prop; both must be
// true for the AI UI to appear. Client-only module (DocEditorImpl is lazy).
export function isAiEnvEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document
      .querySelector('meta[name="dali-ai-enabled"]')
      ?.getAttribute("content") === "1"
  );
}
