// Core ▸ Rooms. The bookable DALI rooms and the iPad door displays. Each iPad
// hangs between two doors and shows both rooms: it's listed under its own room
// and names the second. A display is paired by minting a single-use setup code
// here and typing it into the iPad, which redeems it for its own token (see
// app/lib/room-display.server.ts).

import { useEffect, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Archive, ArchiveRestore, Pencil, Plus, Tablet, Trash2 } from "lucide-react";
import { z } from "zod";
import type { Route } from "./+types/core.rooms";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { parseForm } from "~/lib/validate";
import { formatUserCode } from "~/lib/pairing";
import { createDisplaySetupCode } from "~/lib/room-display.server";
import { getActiveDisplayScan, stopDisplayScan } from "~/lib/display-scan.server";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { coreHandle } from "~/core/coreNav";
import { useOsChrome } from "~/components/os-chrome";
import { Select } from "~/components/ui/floating";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { timeAgo } from "~/components/infra/format";

export const handle = coreHandle("rooms");

export const meta: Route.MetaFunction = () => [{ title: "Rooms · Core · DALI OS" }];

async function requireCoreRooms(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { response: redirectToLogin(request) } as const;
  const userId = auth.user.sub;
  if (!(await isCore(userId))) {
    return { response: redirect("/") } as const;
  }
  return { userId } as const;
}

export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCoreRooms(request);
  if ("response" in gate) throw gate.response;

  const [rooms, scan] = await Promise.all([
    prisma.room.findMany({
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    include: {
      displays: {
        where: { revokedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          label: true,
          activatedAt: true,
          lastSeenAt: true,
          appVersion: true,
          setupCodeExpiresAt: true,
          secondRoom: { select: { id: true, name: true } },
        },
      },
    },
    }),
    getActiveDisplayScan(),
  ]);

  return {
    isAdmin: await isAdmin(gate.userId),
    // The lab-wide iPad scan, if one is live, so Core can stop it from here
    // without finding the event that switched it on.
    activeScan: scan && {
      title: scan.title,
      href: meetingOccurrenceHref(scan.meetingId, scan.occurrenceStart.toISOString()),
      startedBy: scan.startedBy,
      expiresAt: scan.expiresAt.toISOString(),
    },
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      capacity: r.capacity,
      archived: r.archivedAt !== null,
      displays: r.displays.map((d) => ({
        id: d.id,
        label: d.label,
        activated: d.activatedAt !== null,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        appVersion: d.appVersion,
        setupExpired: !d.activatedAt && (!d.setupCodeExpiresAt || d.setupCodeExpiresAt < new Date()),
        secondRoom: d.secondRoom,
      })),
    })),
  };
}

const RoomFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  capacity: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        ctx.addIssue({ code: "custom", message: "Capacity must be a whole number" });
        return z.NEVER;
      }
      return n;
    }),
});

const ActionSchema = z.discriminatedUnion("intent", [
  RoomFields.extend({ intent: z.literal("create-room") }),
  RoomFields.extend({ intent: z.literal("update-room"), id: z.string().min(1) }),
  z.object({ intent: z.literal("archive-room"), id: z.string().min(1) }),
  z.object({ intent: z.literal("unarchive-room"), id: z.string().min(1) }),
  z.object({
    intent: z.literal("add-display"),
    roomId: z.string().min(1),
    secondRoomId: z.string().min(1),
    label: z.string().trim().min(1).max(100),
  }),
  z.object({
    intent: z.literal("update-display"),
    id: z.string().min(1),
    secondRoomId: z.string().min(1),
    label: z.string().trim().min(1).max(100),
  }),
  z.object({ intent: z.literal("revoke-display"), id: z.string().min(1) }),
  z.object({ intent: z.literal("stop-display-scan") }),
]);

export async function action({ request }: Route.ActionArgs) {
  const gate = await requireCoreRooms(request);
  if ("response" in gate) throw gate.response;
  const { userId } = gate;

  const body = await parseForm(request, ActionSchema);
  if (body instanceof Response) return body;

  switch (body.intent) {
    case "create-room": {
      const room = await prisma.room.create({
        data: { name: body.name, description: body.description, capacity: body.capacity },
      });
      await logAuditEvent({ action: "room.create", userId, targetId: room.id, request });
      return { ok: true };
    }
    case "update-room": {
      await prisma.room.update({
        where: { id: body.id },
        data: { name: body.name, description: body.description, capacity: body.capacity },
      });
      await logAuditEvent({ action: "room.update", userId, targetId: body.id, request });
      return { ok: true };
    }
    case "archive-room":
    case "unarchive-room": {
      const archive = body.intent === "archive-room";
      await prisma.room.update({
        where: { id: body.id },
        data: { archivedAt: archive ? new Date() : null },
      });
      await logAuditEvent({
        action: "room.update",
        userId,
        targetId: body.id,
        metadata: { archived: archive },
        request,
      });
      return { ok: true };
    }
    case "add-display": {
      const invalid = await checkDisplayRooms(body.roomId, body.secondRoomId);
      if (invalid) return invalid;
      const setup = await createDisplaySetupCode(body.roomId, body.label, userId, body.secondRoomId);
      await logAuditEvent({
        action: "room.display.create",
        userId,
        targetId: setup.displayId,
        metadata: { roomId: body.roomId, secondRoomId: body.secondRoomId },
        request,
      });
      return {
        ok: true,
        setup: {
          label: body.label,
          code: formatUserCode(setup.code),
          expiresAt: setup.expiresAt.toISOString(),
        },
      };
    }
    case "update-display": {
      const display = await prisma.roomDisplay.findUnique({
        where: { id: body.id },
        select: { roomId: true, revokedAt: true },
      });
      if (!display || display.revokedAt) return Response.json({ error: "Display not found" }, { status: 404 });
      const invalid = await checkDisplayRooms(display.roomId, body.secondRoomId);
      if (invalid) return invalid;
      await prisma.roomDisplay.update({
        where: { id: body.id },
        data: { label: body.label, secondRoomId: body.secondRoomId },
      });
      await logAuditEvent({
        action: "room.display.update",
        userId,
        targetId: body.id,
        metadata: { secondRoomId: body.secondRoomId },
        request,
      });
      return { ok: true };
    }
    case "revoke-display": {
      await prisma.roomDisplay.update({
        where: { id: body.id },
        data: { revokedAt: new Date(), setupCodeHash: null, setupCodeExpiresAt: null },
      });
      await logAuditEvent({ action: "room.display.revoke", userId, targetId: body.id, request });
      return { ok: true };
    }
    case "stop-display-scan": {
      const scan = await getActiveDisplayScan();
      if (!scan) return { ok: true };
      await stopDisplayScan();
      await logAuditEvent({
        action: "room.display.scan.stop",
        userId,
        targetId: scan.meetingId,
        metadata: { title: scan.title, occurrenceStart: scan.occurrenceStart.toISOString() },
        request,
      });
      return { ok: true };
    }
  }
}

/** Both rooms must be live and different; returns the error response if not. */
async function checkDisplayRooms(roomId: string, secondRoomId: string) {
  if (roomId === secondRoomId) {
    return Response.json({ error: "Pick a different room for the other side" }, { status: 400 });
  }
  const live = await prisma.room.count({ where: { id: { in: [roomId, secondRoomId] }, archivedAt: null } });
  if (live !== 2) return Response.json({ error: "Room not found" }, { status: 404 });
  return null;
}

type LoaderRoom = Awaited<ReturnType<typeof loader>>["rooms"][number];
type LoaderDisplay = LoaderRoom["displays"][number];
type DisplayTarget = { room: LoaderRoom; display: LoaderDisplay | null };
type SetupResult = { label: string; code: string; expiresAt: string };

export default function CoreRoomsPage() {
  const { rooms, activeScan } = useLoaderData<typeof loader>();
  const chrome = useOsChrome();
  const [editing, setEditing] = useState<LoaderRoom | "new" | null>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [displayTarget, setDisplayTarget] = useState<DisplayTarget | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className={chrome.pageTitle}>Rooms</h1>
          <p className={`mt-2 ${chrome.bodyText}`}>
            Bookable DALI rooms and the iPad displays outside them.
          </p>
        </div>
        <button type="button" className="os-add-btn" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden />
          Add room
        </button>
      </div>

      {activeScan && <ActiveScanBanner scan={activeScan} />}

      {rooms.length === 0 ? (
        <p className={chrome.bodyText}>No rooms yet.</p>
      ) : (
        rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            onEdit={() => setEditing(room)}
            onEditDisplay={(display) => setDisplayTarget({ room, display })}
          />
        ))
      )}

      <RoomModal room={editing} onClose={() => setEditing(null)} />
      <DisplayModal
        target={displayTarget}
        rooms={rooms}
        onClose={() => setDisplayTarget(null)}
        onSetup={(s) => {
          setDisplayTarget(null);
          setSetup(s);
        }}
      />
      <SetupCodeModal setup={setup} onClose={() => setSetup(null)} />
    </div>
  );
}

function ActiveScanBanner({ scan }: { scan: NonNullable<Awaited<ReturnType<typeof loader>>["activeScan"]> }) {
  const chrome = useOsChrome();
  const dialog = useDialog();
  const toast = useToast();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) toast.error(fetcher.data.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const stop = async () => {
    const ok = await dialog.confirm({
      title: `Stop scanning for "${scan.title}"?`,
      description: "Check-in from the iPads ends for that event and every door display goes back to showing its room.",
      confirmLabel: "Stop scanning",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "stop-display-scan" }, { method: "post" });
  };

  const endsAt = new Date(scan.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <section className={`${chrome.panel} ${chrome.panelPad} flex flex-wrap items-center justify-between gap-4`}>
      <div className="flex min-w-0 items-start gap-3">
        <Tablet className="mt-0.5 h-5 w-5 shrink-0 text-os-accent" aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill dot="success">Scanning on iPads</Pill>
            <Link to={scan.href} className="truncate font-medium text-foreground underline">
              {scan.title}
            </Link>
          </div>
          <p className={`mt-1 ${chrome.bodyText}`}>
            {scan.startedBy ? `Switched on by ${scan.startedBy}. ` : ""}Lapses on its own at {endsAt}.
          </p>
        </div>
      </div>
      <Button variant="destructive" className="shrink-0" onClick={stop} disabled={fetcher.state !== "idle"}>
        Stop scanning
      </Button>
    </section>
  );
}

function RoomCard({
  room,
  onEdit,
  onEditDisplay,
}: {
  room: LoaderRoom;
  onEdit: () => void;
  // Null adds a new display to this room.
  onEditDisplay: (display: LoaderDisplay | null) => void;
}) {
  const chrome = useOsChrome();
  const dialog = useDialog();
  const toast = useToast();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const toggleArchive = async () => {
    if (!room.archived) {
      const ok = await dialog.confirm({
        title: `Archive ${room.name}?`,
        description: "It stops taking new bookings. Existing bookings and its history stay.",
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    fetcher.submit({ intent: room.archived ? "unarchive-room" : "archive-room", id: room.id }, { method: "post" });
  };

  const revoke = async (display: LoaderDisplay) => {
    const ok = await dialog.confirm({
      title: `Remove ${display.label}?`,
      description: "The iPad signs out and has to be set up again with a new code.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "revoke-display", id: display.id }, { method: "post" });
  };

  return (
    <section className={`${chrome.panel} ${chrome.panelPad} flex flex-col gap-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={chrome.sectionTitle}>{room.name}</h2>
            {room.archived && <Pill dot="neutral">Archived</Pill>}
          </div>
          <p className={`mt-1 ${chrome.bodyText}`}>
            {[room.description, room.capacity ? `Seats ${room.capacity}` : null].filter(Boolean).join(" · ") ||
              "No details"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Edit room" icon={Pencil} onClick={onEdit} />
          <IconButton
            label={room.archived ? "Unarchive room" : "Archive room"}
            icon={room.archived ? ArchiveRestore : Archive}
            onClick={toggleArchive}
          />
        </div>
      </div>

      {!room.archived && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="os-field-label">Door displays</span>
            <button type="button" className="os-add-btn os-add-btn--sm" onClick={() => onEditDisplay(null)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add display
            </button>
          </div>
          {room.displays.length === 0 ? (
            <p className={chrome.bodyText}>No display paired.</p>
          ) : (
            <ul className="os-item-list">
              {room.displays.map((d) => (
                <li key={d.id} className="os-item-row flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {d.label}
                    <span className="text-muted-foreground">
                      {d.secondRoom ? ` · also shows ${d.secondRoom.name}` : " · one room only"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {d.activated ? (
                      <>
                        {d.appVersion && (
                          <span className="text-xs text-muted-foreground" title="App version">
                            v{d.appVersion}
                          </span>
                        )}
                        <Pill dot="success">Seen {timeAgo(d.lastSeenAt)}</Pill>
                      </>
                    ) : d.setupExpired ? (
                      <Pill dot="danger">Setup code expired</Pill>
                    ) : (
                      <Pill dot="warning">Waiting for setup</Pill>
                    )}
                    <IconButton label="Edit display" icon={Pencil} onClick={() => onEditDisplay(d)} />
                    <IconButton label="Remove display" icon={Trash2} onClick={() => revoke(d)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function RoomModal({ room, onClose }: { room: LoaderRoom | "new" | null; onClose: () => void }) {
  const chrome = useOsChrome();
  const toast = useToast();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const existing = room && room !== "new" ? room : null;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal open={room !== null} onClose={onClose} labelledBy="room-modal-title">
      <ModalHeader titleId="room-modal-title" title={existing ? "Edit room" : "Add room"} onClose={onClose} />
      <fetcher.Form method="post" className={`${chrome.formClass} flex flex-col gap-5`} key={existing?.id ?? "new"}>
        <input type="hidden" name="intent" value={existing ? "update-room" : "create-room"} />
        {existing && <input type="hidden" name="id" value={existing.id} />}
        <label className="os-field-group">
          <span>Name</span>
          <input type="text" name="name" required maxLength={100} defaultValue={existing?.name ?? ""} />
        </label>
        <label className="os-field-group">
          <span>Where it is</span>
          <input
            type="text"
            name="description"
            maxLength={300}
            placeholder="Sudikoff, 1st floor"
            defaultValue={existing?.description ?? ""}
          />
        </label>
        <label className="os-field-group">
          <span>Seats</span>
          <input type="number" name="capacity" min={1} max={1000} defaultValue={existing?.capacity ?? ""} />
        </label>
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary" disabled={busy}>
            {existing ? "Save" : "Add room"}
          </button>
        </ModalFooter>
      </fetcher.Form>
    </Modal>
  );
}

function DisplayModal({
  target,
  rooms,
  onClose,
  onSetup,
}: {
  target: DisplayTarget | null;
  rooms: LoaderRoom[];
  onClose: () => void;
  onSetup: (s: SetupResult) => void;
}) {
  const chrome = useOsChrome();
  const toast = useToast();
  const fetcher = useFetcher<{ ok?: boolean; error?: string; setup?: SetupResult }>();
  const busy = fetcher.state !== "idle";
  const room = target?.room;
  const display = target?.display ?? null;
  const others = rooms.filter((r) => !r.archived && r.id !== room?.id);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.setup) onSetup(fetcher.data.setup);
    else if (fetcher.data.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal open={target !== null} onClose={onClose} labelledBy="display-modal-title">
      <ModalHeader
        titleId="display-modal-title"
        title={display ? "Edit door display" : "Add a door display"}
        subtitle="The iPad shows this room and the one beside it."
        onClose={onClose}
      />
      <fetcher.Form
        method="post"
        className={`${chrome.formClass} flex flex-col gap-5`}
        key={display?.id ?? room?.id ?? "none"}
      >
        <input type="hidden" name="intent" value={display ? "update-display" : "add-display"} />
        {display ? (
          <input type="hidden" name="id" value={display.id} />
        ) : (
          <input type="hidden" name="roomId" value={room?.id ?? ""} />
        )}
        <label className="os-field-group">
          <span>Display name</span>
          <input
            type="text"
            name="label"
            required
            maxLength={100}
            defaultValue={display?.label ?? (room ? `${room.name} door` : "")}
          />
        </label>
        <div className="os-field-group">
          <span className="os-field-label">Other room</span>
          {others.length === 0 ? (
            <p className={chrome.bodyText}>Add a second room first.</p>
          ) : (
            <Select
              name="secondRoomId"
              required
              defaultValue={display?.secondRoom?.id}
              placeholder="Pick a room"
              options={others.map((r) => ({ value: r.id, label: r.name }))}
              ariaLabel="Other room"
              buttonClassName={chrome.formTrigger}
            />
          )}
        </div>
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary" disabled={busy || others.length === 0}>
            {display ? "Save" : "Get setup code"}
          </button>
        </ModalFooter>
      </fetcher.Form>
    </Modal>
  );
}

function SetupCodeModal({ setup, onClose }: { setup: SetupResult | null; onClose: () => void }) {
  const chrome = useOsChrome();
  return (
    <Modal open={setup !== null} onClose={onClose} labelledBy="setup-code-title">
      <ModalHeader titleId="setup-code-title" title={`Set up ${setup?.label ?? "display"}`} onClose={onClose} />
      <p className={chrome.bodyText}>On the iPad, open DALI OS and enter this code.</p>
      <p className="my-6 text-center font-mono text-4xl font-semibold tracking-widest text-foreground">
        {setup?.code}
      </p>
      <p className={chrome.bodyText}>
        It works once and expires at{" "}
        {setup ? new Date(setup.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}.
      </p>
      <div className="os-modal-footer mt-6">
        <button type="button" className="os-btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
