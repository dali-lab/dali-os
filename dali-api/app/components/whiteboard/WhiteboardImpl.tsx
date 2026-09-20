import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { acquireCollabDoc, releaseCollabDoc, nameToHexColor } from "~/components/doc/collab-doc";
import { whiteboardRoomName } from "~/collab/roomName";
import { bindExcalidrawToYjs, type WhiteboardBinding } from "./whiteboard-yjs";
import { uploadWhiteboardImage } from "./upload";
import type { WhiteboardEditorProps } from "./WhiteboardEditor";

export default function WhiteboardImpl(props: WhiteboardEditorProps) {
  // title/iconEmoji come through props but the shell breadcrumb renders them now.
  const { pageId, canEdit, collabToken, userName, photoUrl } = props;
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<WhiteboardBinding | null>(null);
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
    <div className="dali-whiteboard relative min-h-0 flex-1 bg-page">
      <Excalidraw
        excalidrawAPI={(a) => setApi(a)}
        initialData={initialData}
        viewModeEnabled={!canEdit}
        theme={theme}
        isCollaborating
        onChange={(elements, appState, files) =>
          bindingRef.current?.onChange(elements, appState, files)
        }
        onPointerUpdate={(payload) => bindingRef.current?.onPointerUpdate(payload)}
      >
        {/* Trim Excalidraw-specific chrome so the board reads as a DALI surface:
            a custom menu without the Excalidraw+ upsell / social links / Help
            (its dialog links out to Excalidraw), and a welcome screen without the
            Excalidraw logo. The Help "?" button and the community-library button
            are hidden via whiteboard.css. Theme follows the app (the `theme` prop
            above), so no theme toggle here. */}
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              Start on the canvas — everyone here sees it live.
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
