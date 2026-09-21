import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  FONT_FAMILY,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Trash2, Maximize2, Minimize2, Workflow, Frame, Wand2 } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { acquireCollabDoc, releaseCollabDoc, nameToHexColor } from "~/components/doc/collab-doc";
import { whiteboardRoomName } from "~/collab/roomName";
import { bindExcalidrawToYjs, type WhiteboardBinding } from "./whiteboard-yjs";
import { uploadWhiteboardImage } from "./upload";
import { MermaidDialog, type DiagramInsert } from "./MermaidDialog";
import type { WhiteboardEditorProps } from "./WhiteboardEditor";

// Shared style for our custom top-right buttons so they read like Excalidraw's
// own islands in light and dark.
const TOP_BTN_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white text-gray-700 shadow-sm transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-[#232329] dark:text-gray-200 dark:hover:bg-[#2d2d36]";

export default function WhiteboardImpl(props: WhiteboardEditorProps) {
  // title/iconEmoji come through props but the shell breadcrumb renders them now.
  const { pageId, canEdit, collabToken, userName, photoUrl } = props;
  const dialog = useDialog();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<WhiteboardBinding | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const roomName = useMemo(() => whiteboardRoomName(pageId), [pageId]);
  const theme = useMemo<"light" | "dark">(
    () =>
      typeof document !== "undefined" && document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    [],
  );

  // Shed most of Excalidraw's hand-drawn aesthetic by defaulting new shapes to
  // precise lines (roughness 0, not the "artist" wobble), a solid fill (not the
  // sketchy hachure crosshatch), and a clean sans font (not Excalifont). These
  // are per-client UI defaults for newly-drawn elements — existing elements keep
  // their own style, and users can still opt back into a sketchier look.
  const initialData = useMemo(
    () => ({
      appState: {
        currentItemRoughness: 0,
        currentItemFillStyle: "solid" as const,
        currentItemFontFamily: FONT_FAMILY.Nunito,
      },
    }),
    [],
  );

  // Clear via the DALI confirm dialog (useDialog) instead of Excalidraw's own
  // confirm modal, then wipe the scene — the binding propagates the clear to
  // peers. Captured in local history so the author can undo.
  async function handleClearCanvas() {
    if (!api) return;
    const confirmed = await dialog.confirm({
      title: "Clear canvas",
      description: "This will clear the whole whiteboard for everyone. Are you sure?",
      tone: "destructive",
      confirmLabel: "Clear",
    });
    if (!confirmed) return;
    api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  // Insert a diagram (already normalized to the board's clean style by the
  // dialog) as native elements; the binding propagates them to peers.
  function handleInsertDiagram(payload: DiagramInsert) {
    if (!api) return;
    if (payload.files) {
      const files = Object.values(payload.files);
      if (files.length) api.addFiles(files);
    }
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...payload.elements],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent(payload.elements, { fitToContent: true, animate: true });
  }

  // Acquire the shared Y.Doc + provider and wire the binding once the Excalidraw
  // imperative API is ready. The doc cache is refcounted with a dispose debounce,
  // so React StrictMode's double-invoke reuses the same instance.
  useEffect(() => {
    if (!api || !collabToken) return;
    const entry = acquireCollabDoc(roomName, collabToken);
    const binding = bindExcalidrawToYjs({
      ydoc: entry.ydoc,
      awareness: entry.provider.awareness ?? null,
      api,
      editable: canEdit,
      user: { name: userName, color: nameToHexColor(userName), avatarUrl: photoUrl },
      uploadFile: uploadWhiteboardImage,
    });
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
      releaseCollabDoc(roomName);
    };
  }, [api, roomName, collabToken, canEdit, userName, photoUrl]);

  return (
    <div
      className={
        isFullscreen
          ? "dali-whiteboard fixed inset-0 z-40 bg-page"
          : "dali-whiteboard relative min-h-0 flex-1 bg-page"
      }
    >
      <Excalidraw
        excalidrawAPI={(a) => setApi(a)}
        initialData={initialData}
        viewModeEnabled={!canEdit}
        theme={theme}
        isCollaborating
        renderTopRightUI={() => (
          <div className="flex items-center gap-1.5">
            {canEdit && (
              <button
                type="button"
                onClick={() => setDiagramOpen(true)}
                title="Insert diagram"
                aria-label="Insert diagram"
                className={TOP_BTN_CLASS}
              >
                <Workflow className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              className={TOP_BTN_CLASS}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        )}
        onChange={(elements, appState, files) =>
          bindingRef.current?.onChange(elements, appState, files)
        }
        onPointerUpdate={(payload) => bindingRef.current?.onPointerUpdate(payload)}
      >
        {/* Trim Excalidraw-specific chrome so the board reads as a DALI surface:
            a custom menu without the Excalidraw+ upsell / social links, and a
            welcome screen without the Excalidraw logo. The Help modal stays (for
            its keyboard-shortcuts reference); its top row of Excalidraw links and
            the community-library button are hidden via whiteboard.css. Theme
            follows the app (the `theme` prop above), so no theme toggle here. */}
        <MainMenu>
          {canEdit && (
            <MainMenu.Item
              icon={<Frame className="h-4 w-4" />}
              shortcut="F"
              onSelect={() => api?.setActiveTool({ type: "frame" })}
            >
              Frame tool
            </MainMenu.Item>
          )}
          <MainMenu.Item
            icon={<Wand2 className="h-4 w-4" />}
            shortcut="K"
            onSelect={() => api?.setActiveTool({ type: "laser" })}
          >
            Laser pointer
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          {canEdit && (
            <MainMenu.Item
              icon={<Trash2 className="h-4 w-4" />}
              onSelect={() => void handleClearCanvas()}
            >
              Clear canvas
            </MainMenu.Item>
          )}
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              Start drawing. Everyone on this board sees your changes live.
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
      <MermaidDialog
        open={diagramOpen}
        onClose={() => setDiagramOpen(false)}
        onInsert={handleInsertDiagram}
      />
    </div>
  );
}
