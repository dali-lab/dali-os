import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { acquireCollabDoc, releaseCollabDoc, nameToHexColor } from "~/components/doc/collab-doc";
import { whiteboardRoomName } from "~/collab/roomName";
import { bindExcalidrawToYjs, type WhiteboardBinding } from "./whiteboard-yjs";
import type { WhiteboardEditorProps } from "./WhiteboardEditor";

export default function WhiteboardImpl(props: WhiteboardEditorProps) {
  const { pageId, title, iconEmoji, canEdit, collabToken, userName, photoUrl } = props;
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
    });
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
      releaseCollabDoc(roomName);
    };
  }, [api, roomName, collabToken, canEdit, userName, photoUrl]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-page">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link
          to="/drive"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Drive
        </Link>
        <span className="text-border">/</span>
        {iconEmoji ? <span className="text-base leading-none">{iconEmoji}</span> : null}
        <span className="truncate font-medium text-foreground">{title}</span>
        {!canEdit && (
          <span className="ml-2 rounded bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
            View only
          </span>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={(a) => setApi(a)}
          viewModeEnabled={!canEdit}
          theme={theme}
          isCollaborating
          onChange={(elements, appState, files) =>
            bindingRef.current?.onChange(elements, appState, files)
          }
          onPointerUpdate={(payload) => bindingRef.current?.onPointerUpdate(payload)}
        />
      </div>
    </div>
  );
}
