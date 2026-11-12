import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  Footer,
  FONT_FAMILY,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Trash2, Maximize2, Minimize2, Workflow, Frame, Wand2, FolderSearch } from "lucide-react";
import { PageBarPortal, PageBarTitle, pageBarTextButton } from "~/components/shell/page-bar-slot";
import { PageBarShareButton } from "~/components/shell/PageBarShareButton";
import { PageTitleHeader } from "~/components/doc-chrome/PageTitleHeader";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { Tooltip } from "~/components/ui/floating";
import { MeetingStrip } from "~/components/meeting/MeetingStrip";
import { meetingPlaceLabel, meetingSubtitle } from "~/components/meeting/meeting-strip-model";
import { useDialog } from "~/components/ui/dialog";
import { revealInDriveHref } from "~/drive/lib/drive-crumbs";
import { acquireCollabDoc, releaseCollabDoc, nameToHexColor } from "~/components/doc/collab-doc";
import { whiteboardRoomName } from "~/collab/roomName";
import { bindExcalidrawToYjs, type WhiteboardBinding } from "./whiteboard-yjs";
import { uploadWhiteboardImage } from "./upload";
import { MermaidDialog, type DiagramInsert } from "./MermaidDialog";
import type { WhiteboardEditorProps } from "./WhiteboardEditor";

// Shared style for our custom top-right buttons so they read like Excalidraw's
// own islands in light and dark.
const TOP_BTN_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-os-grey shadow-sm transition-colors hover:bg-os-hover";

export default function WhiteboardImpl(props: WhiteboardEditorProps) {
  const { pageId, title, canEdit, collabToken, userName, photoUrl, meeting, canManageAccess, workspaceType } = props;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [shareOpen, setShareOpen] = useState(false);
  const [emoji, setEmoji] = useState(props.iconEmoji);
  async function savePage(patch: { title?: string; iconEmoji?: string | null }) {
    if (patch.iconEmoji !== undefined) setEmoji(patch.iconEmoji);
    await fetch(`/api/documents/${pageId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    revalidator.revalidate();
  }
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
      title: "Clear the canvas?",
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
          ? "dali-whiteboard fixed inset-0 z-40 flex flex-col bg-page"
          : "dali-whiteboard relative flex min-h-0 flex-1 flex-col bg-page"
      }
    >
      <PageBarTitle
        title={title}
        onRename={canEdit ? (name) => savePage({ title: name }) : undefined}
        emoji={emoji}
      />
      {!isFullscreen && (
        <PageTitleHeader
          className="px-4 pt-4 pb-3"
          title={title}
          iconEmoji={emoji ?? null}
          canEdit={canEdit}
          onRename={(name) => savePage({ title: name })}
          onIconChange={(next) => void savePage({ iconEmoji: next })}
        />
      )}
      <PageBarPortal slot="actions">
        <Tooltip content={isFullscreen ? "Exit full screen" : "Full screen"}>
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            className={pageBarTextButton(isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline">Full screen</span>
          </button>
        </Tooltip>
        {canManageAccess && <PageBarShareButton onClick={() => setShareOpen(true)} />}
      </PageBarPortal>
      {canManageAccess && (
        <ShareDialog
          page={{ id: pageId, title, workspaceType }}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onChanged={() => revalidator.revalidate()}
        />
      )}
      {meeting?.startIso && (
        <MeetingStrip
          title={meeting.title}
          subtitle={meetingSubtitle({
            startIso: meeting.startIso,
            place: meetingPlaceLabel(meeting),
            recordedMinutes: null,
          })}
          noteHref={meeting.notePageId ? `/documents/${meeting.notePageId}` : null}
          attendance={{
            label: meeting.attendance ? `${meeting.attendance.attended} of ${meeting.attendance.expected}` : "",
            to: `/calendar/meeting/${meeting.id}`,
          }}
          recorder={
            canEdit && meeting.notePageId
              ? { phase: "before", onRecord: () => navigate(`/documents/${meeting.notePageId}?record=1`) }
              : null
          }
        />
      )}
      <div className="relative min-h-0 flex-1">
      <Excalidraw
        excalidrawAPI={(a) => setApi(a)}
        initialData={initialData}
        viewModeEnabled={!canEdit}
        theme={theme}
        isCollaborating
        renderTopRightUI={() =>
          isFullscreen ? (
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              title="Exit full screen"
              aria-label="Exit full screen"
              className={TOP_BTN_CLASS}
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          ) : null
        }
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
          <MainMenu.Item
            icon={<FolderSearch className="h-4 w-4" />}
            onSelect={() => window.location.assign(revealInDriveHref(pageId))}
          >
            Reveal in Drive
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
        {canEdit && (
          <Footer>
            <button
              type="button"
              onClick={() => setDiagramOpen(true)}
              title="Insert a diagram from Mermaid"
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-os-grey shadow-sm transition-colors hover:bg-os-hover"
            >
              <Workflow className="h-4 w-4" /> Insert diagram
            </button>
          </Footer>
        )}
      </Excalidraw>
      </div>
      <MermaidDialog
        open={diagramOpen}
        onClose={() => setDiagramOpen(false)}
        onInsert={handleInsertDiagram}
      />
    </div>
  );
}
