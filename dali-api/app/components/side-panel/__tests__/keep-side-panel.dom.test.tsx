// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { useKeepSidePanel, useSidePanel } from "~/components/side-panel/use-side-panel";
import { setKeptSidePanel } from "~/lib/side-panel";

vi.mock("~/components/FeatureFlags", () => ({ useFeatureFlag: () => true }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let panelMounts = 0;
let api: {
  navigate: ReturnType<typeof useNavigate>;
  open: (id: string) => void;
  close: () => void;
};

function Panel({ id }: { id: string }) {
  useEffect(() => {
    panelMounts++;
  }, []);
  return <output data-testid="panel">{id}</output>;
}

function Harness() {
  const { panel, open, close } = useSidePanel();
  const navigate = useNavigate();
  const location = useLocation();
  useKeepSidePanel();
  api = { navigate, open: (id) => open({ type: "doc", id }), close };
  return (
    <>
      <span data-testid="at">{location.pathname + location.search}</span>
      {panel && <Panel key={panel.id} id={panel.id} />}
    </>
  );
}

function mount(entry = "/one") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Harness />
      </MemoryRouter>,
    ),
  );
}

const shown = () => container.querySelector("[data-testid=panel]")?.textContent ?? null;
const at = () => container.querySelector("[data-testid=at]")!.textContent;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  act(() => setKeptSidePanel(null));
  panelMounts = 0;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("opening the side panel", () => {
  it("shows at once without a router navigation, so the page's loaders don't re-run", () => {
    mount("/one?tab=drive");
    act(() => api.open("abc"));
    expect(shown()).toBe("abc");
    expect(at()).toBe("/one?tab=drive");
    expect(new URL(window.location.href).searchParams.get("side")).toBe("doc:abc");
  });

  it("closes after an instant open", () => {
    mount();
    act(() => api.open("abc"));
    act(() => api.close());
    expect(shown()).toBeNull();
    expect(new URL(window.location.href).searchParams.get("side")).toBeNull();
  });

  it("switches panels through the router when the address already names one", () => {
    mount("/one?side=doc:xyz");
    expect(shown()).toBe("xyz");
    act(() => api.open("abc"));
    expect(shown()).toBe("abc");
    expect(at()).toBe("/one?side=doc%3Aabc");
  });

  it("navigates below md, so Back can close the panel", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    mount("/one");
    act(() => api.open("abc"));
    expect(at()).toBe("/one?side=doc%3Aabc");
  });
});

describe("keeping the side panel across navigation", () => {
  it("stays open, without remounting, when the page changes", () => {
    mount();
    act(() => api.open("abc"));
    expect(shown()).toBe("abc");
    act(() => {
      void api.navigate("/two");
    });
    expect(shown()).toBe("abc");
    expect(panelMounts).toBe(1);
  });

  it("writes the panel back to the address bar without a router navigation", () => {
    mount();
    act(() => api.open("abc"));
    act(() => {
      void api.navigate("/two?tab=drive");
    });
    expect(at()).toBe("/two?tab=drive");
    expect(window.location.pathname + window.location.search).toBe("/two?tab=drive&side=doc%3Aabc");
  });

  it("stays closed after closing on a page it was carried to", () => {
    mount();
    act(() => api.open("abc"));
    act(() => {
      void api.navigate("/two");
    });
    act(() => api.close());
    expect(shown()).toBeNull();
    expect(window.location.search).toBe("");
    act(() => {
      void api.navigate("/three");
    });
    expect(shown()).toBeNull();
  });

  it("closes when closed on the page it was opened from", () => {
    mount();
    act(() => api.open("abc"));
    act(() => api.close());
    expect(shown()).toBeNull();
    expect(at()).toBe("/one");
  });

  it("closes when the page navigates to that document", () => {
    mount();
    act(() => api.open("abc"));
    act(() => {
      void api.navigate("/documents/abc");
    });
    expect(shown()).toBeNull();
    act(() => {
      void api.navigate("/two");
    });
    expect(shown()).toBeNull();
  });

  it("closes on a move to another tab", () => {
    mount();
    act(() => api.open("abc"));
    act(() => {
      void api.navigate("/tab-b", { replace: true, state: { tabSwitch: true } });
    });
    expect(shown()).toBeNull();
  });

  it("doesn't add a history entry to open on a wide window, so Back moves the page", () => {
    mount("/one");
    act(() => {
      void api.navigate("/two");
    });
    act(() => api.open("abc"));
    act(() => {
      void api.navigate(-1);
    });
    expect(at()).toBe("/one");
    expect(shown()).toBe("abc");
  });

  it("closes on Back below md, where the panel covers the page", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    mount("/one");
    act(() => api.open("abc"));
    expect(shown()).toBe("abc");
    act(() => {
      void api.navigate(-1);
    });
    expect(at()).toBe("/one");
    expect(shown()).toBeNull();
  });
});
