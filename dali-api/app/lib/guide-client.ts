// Opening the guide from a page. In tabbed mode a page renders inside a
// workspace iframe while the guide card lives in the shell, so a plain
// window.dispatchEvent would fire into the iframe and reach nothing. Post to
// the parent when we're embedded; dispatch locally when we aren't.

export type StartGuideOptions = { restart?: boolean };

export function startGuide({ restart = false }: StartGuideOptions = {}) {
  if (typeof window === "undefined") return;
  if (window.self !== window.top) {
    window.parent.postMessage(
      { type: "dali:start-tour", restart },
      window.location.origin,
    );
    return;
  }
  window.dispatchEvent(
    new CustomEvent("dali:start-tour", { detail: { restart } }),
  );
}
