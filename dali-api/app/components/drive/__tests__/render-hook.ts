import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mounts `hook` in a throwaway component. `result.current` is the latest return value. */
export function renderHook<P, R>(
  hook: (props: P) => R,
  { initialProps, wrapper }: { initialProps: P; wrapper?: (children: ReactNode) => ReactNode },
) {
  const result = { current: undefined as unknown as R };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  const draw = (props: P) => root.render(wrapper ? (wrapper(createElement(Harness, { props })) as never) : createElement(Harness, { props }));
  act(() => draw(initialProps));
  return {
    result,
    rerender: (props: P) => act(() => draw(props)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
