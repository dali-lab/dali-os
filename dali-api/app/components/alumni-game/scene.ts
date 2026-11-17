// The virtual lab: a 2D canvas scene in the style of the technigala tunnel
// engine — the React shell owns HTML UI (phone, hints), this owns the loop.
// World coordinates are the 2560x1440 pixels of the lab art; the camera
// follows the avatar in cover mode so the art stays crisp and fills the view.

import {
  WORLD,
  SPAWN,
  AVATAR_WORLD_HEIGHT,
  INTERACT_RADIUS,
  INTERACTABLES,
  NPCS,
  isBlocked,
  nearestHotspot,
  hotspotAtPoint,
  type Hotspot,
  type Npc,
} from "./lab-data";
import { SPRITE_VIEW, type AvatarSprites } from "./pixel-avatar";

export type LabAssets = {
  base: string;
  overlays: Record<string, string>;
  npcs: Record<"tim" | "lorie", string>;
};

export type LabSceneCallbacks = {
  onHint: (hint: string | null) => void;
  onNpc: (id: "tim" | "lorie") => void;
  // A one-off flavor line after opening an interactable.
  onFlavor: (text: string) => void;
};

export type RemotePlayerState = {
  id: string;
  name: string;
  sprites: AvatarSprites;
  x: number;
  y: number;
};

export type LabScene = {
  destroy: () => void;
  say: (npc: "tim" | "lorie", text: string) => void;
  setPaused: (paused: boolean) => void;
  // Shows or hides the quest "?" marker above an NPC's head.
  setMarker: (npc: "tim" | "lorie", on: boolean) => void;
  // Other alumni on the same server; positions are lerped between updates.
  setRemotePlayers: (players: RemotePlayerState[]) => void;
  getPosition: () => { x: number; y: number };
  clearHighlight: () => void;
};

// Pixel "?" glyph, 5 columns, drawn cell by cell above a quest giver.
const QUEST_GLYPH = [
  "01110",
  "11011",
  "00011",
  "00110",
  "00100",
  "00000",
  "00100",
];

const SPEED = 440;

export function clampPanAxis(pan: number, center: number, view: number, worldSize: number): number {
  const min = view / 2 - center;
  const max = worldSize - view / 2 - center;
  if (min >= max) return 0;
  return Math.min(Math.max(pan, min), max);
}

function hintFor(spot: Hotspot | null): string | null {
  if (!spot) return null;
  if (spot.kind === "npc") return `Click ${spot.target.name} to talk`;
  return `Click ${spot.target.label} to open it`;
}

export function createLabScene(
  canvas: HTMLCanvasElement,
  assets: LabAssets,
  avatarSprites: AvatarSprites,
  playerName: string,
  cb: LabSceneCallbacks,
): LabScene {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      destroy() {},
      say() {},
      setPaused() {},
      setMarker() {},
      setRemotePlayers() {},
      getPosition: () => ({ x: SPAWN.x, y: SPAWN.y }),
      clearHighlight() {},
    };
  }

  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const load = (src: string) => {
    const img = new Image();
    img.src = src;
    return img;
  };
  const baseImg = load(assets.base);
  const overlayImgs = new Map(
    INTERACTABLES.map((it) => [it.id, load(assets.overlays[it.id])] as const),
  );
  const npcImgs = { tim: load(assets.npcs.tim), lorie: load(assets.npcs.lorie) };
  // Animated GIFs re-decode on every drawImage in some webviews; snapshot
  // each NPC to a static canvas once and draw that instead.
  const npcSnaps: Partial<Record<"tim" | "lorie", HTMLCanvasElement>> = {};
  function npcSnapshot(id: "tim" | "lorie"): HTMLCanvasElement | null {
    const cached = npcSnaps[id];
    if (cached) return cached;
    const img = npcImgs[id];
    if (!img.complete || img.naturalWidth === 0) return null;
    const snap = document.createElement("canvas");
    snap.width = img.naturalWidth;
    snap.height = img.naturalHeight;
    snap.getContext("2d")!.drawImage(img, 0, 0);
    npcSnaps[id] = snap;
    return snap;
  }

  // White outline for the selected character: the figure is drawn into a
  // scratch canvas, dilated into a silhouette, and stamped behind the art.
  const OUTLINE_PAD = 8;
  const outlineScratch = document.createElement("canvas");
  const outlineSilhouette = document.createElement("canvas");
  function drawWithOutline(
    x0: number,
    y0: number,
    w: number,
    h: number,
    paint: (c: CanvasRenderingContext2D) => void,
  ) {
    const cw = Math.ceil(w + OUTLINE_PAD * 2);
    const ch = Math.ceil(h + OUTLINE_PAD * 2);
    if (outlineScratch.width < cw || outlineScratch.height < ch) {
      outlineScratch.width = cw;
      outlineScratch.height = ch;
      outlineSilhouette.width = cw;
      outlineSilhouette.height = ch;
    }
    const sc = outlineScratch.getContext("2d")!;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, cw, ch);
    sc.imageSmoothingEnabled = false;
    sc.translate(OUTLINE_PAD - x0, OUTLINE_PAD - y0);
    paint(sc);
    const oc = outlineSilhouette.getContext("2d")!;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.globalCompositeOperation = "source-over";
    oc.clearRect(0, 0, cw, ch);
    for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
      oc.drawImage(outlineScratch, dx, dy);
    }
    oc.globalCompositeOperation = "source-in";
    oc.fillStyle = "#ffffff";
    oc.fillRect(0, 0, cw, ch);
    ctx!.drawImage(outlineSilhouette, 0, 0, cw, ch, x0 - OUTLINE_PAD, y0 - OUTLINE_PAD, cw, ch);
    paint(ctx!);
  }

  const pos: { x: number; y: number } = { x: SPAWN.x, y: SPAWN.y };
  let dir: "down" | "left" | "right" | "up" = "down";
  let clickTarget: { x: number; y: number; spot: Hotspot | null } | null = null;
  let paused = false;
  let destroyed = false;
  const open = new Set<string>();
  const markers = new Set<"tim" | "lorie">();
  const speech = new Map<"tim" | "lorie", { text: string; until: number }>();
  type Remote = RemotePlayerState & { rx: number; ry: number };
  const remotes = new Map<string, Remote>();
  let highlighted: { kind: "npc" | "remote"; id: string } | null = null;
  const keys = new Set<string>();
  let walkMs = 0;
  let nextBlinkAt = performance.now() + 2200;
  let lastHint: string | null = null;
  let last = performance.now();

  // Mouse wheel zooms between cover-fit (1x) and 2.5x, centered on the avatar.
  let zoom = 1;
  const viewScale = () =>
    Math.max(canvas.clientWidth / WORLD.width, canvas.clientHeight / WORLD.height) * zoom;

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoom = Math.min(2.5, Math.max(1, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  }

  // Middle-button drag pans the camera away from the avatar; walking eases it back.
  let panX = 0;
  let panY = 0;
  let dragging: { x: number; y: number } | null = null;

  function camera() {
    const s = viewScale();
    const vw = canvas.clientWidth / s;
    const vh = canvas.clientHeight / s;
    const cx = Math.min(Math.max(pos.x + panX - vw / 2, 0), WORLD.width - vw);
    const cy = Math.min(
      Math.max(pos.y - AVATAR_WORLD_HEIGHT / 2 + panY - vh / 2, 0),
      WORLD.height - vh,
    );
    return { s, cx, cy, vw, vh };
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    dragging = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = "grabbing";
    lastCursor = "grabbing";
  }

  function onDragMove(e: MouseEvent) {
    if (!dragging) return;
    const { s, vw, vh } = camera();
    panX = clampPanAxis(panX - (e.clientX - dragging.x) / s, pos.x, vw, WORLD.width);
    panY = clampPanAxis(
      panY - (e.clientY - dragging.y) / s,
      pos.y - AVATAR_WORLD_HEIGHT / 2,
      vh,
      WORLD.height,
    );
    dragging = { x: e.clientX, y: e.clientY };
  }

  function onDragEnd(e: MouseEvent) {
    if (e.button !== 1 || !dragging) return;
    dragging = null;
    canvas.style.cursor = "default";
    lastCursor = "default";
  }

  function interact(spot: Hotspot | null) {
    if (!spot) return;
    if (spot.kind === "interactable") {
      const id = spot.target.id;
      if (open.has(id)) {
        open.delete(id);
      } else {
        open.add(id);
        cb.onFlavor(spot.target.flavor);
      }
    } else {
      cb.onNpc(spot.target.id);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (paused) return;
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (k === "e" || k === "enter" || k === " ") {
      interact(nearestHotspot(pos.x, pos.y));
      return;
    }
    keys.add(k);
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key.toLowerCase());
  }
  function onBlur() {
    keys.clear();
  }

  function onClick(e: MouseEvent) {
    if (paused) return;
    const rect = canvas.getBoundingClientRect();
    const { s, cx, cy } = camera();
    const wx = (e.clientX - rect.left) / s + cx;
    const wy = (e.clientY - rect.top) / s + cy;
    // Clicking another alumni selects them.
    for (const r of remotes.values()) {
      if (Math.abs(wx - r.rx) <= 80 && wy >= r.ry - 260 && wy <= r.ry + 24) {
        highlighted = { kind: "remote", id: r.id };
        return;
      }
    }
    const spot = hotspotAtPoint(wx, wy);
    highlighted = spot?.kind === "npc" ? { kind: "npc", id: spot.target.id } : null;
    if (spot) {
      const reach = Math.hypot(pos.x - spot.target.at.x, pos.y - spot.target.at.y);
      if (reach <= INTERACT_RADIUS) {
        interact(spot);
        clickTarget = null;
        return;
      }
      clickTarget = { x: spot.target.at.x, y: spot.target.at.y, spot };
      return;
    }
    if (!isBlocked(wx, wy)) clickTarget = { x: wx, y: wy, spot: null };
  }

  let lastCursor = "";
  function onMouseMove(e: MouseEvent) {
    if (dragging) return;
    const rect = canvas.getBoundingClientRect();
    const { s, cx, cy } = camera();
    const wx = (e.clientX - rect.left) / s + cx;
    const wy = (e.clientY - rect.top) / s + cy;
    const cursor = hotspotAtPoint(wx, wy) ? "pointer" : "default";
    if (cursor !== lastCursor) {
      lastCursor = cursor;
      canvas.style.cursor = cursor;
    }
  }

  function move(dt: number) {
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    if (dx !== 0 || dy !== 0) clickTarget = null;
    // Click-to-walk: steer toward the clicked point, interact on arrival.
    if (dx === 0 && dy === 0 && clickTarget) {
      const spot = clickTarget.spot;
      if (spot && Math.hypot(pos.x - spot.target.at.x, pos.y - spot.target.at.y) <= INTERACT_RADIUS - 20) {
        interact(spot);
        clickTarget = null;
      } else if (Math.hypot(pos.x - clickTarget.x, pos.y - clickTarget.y) < 10) {
        clickTarget = null;
      } else {
        dx = clickTarget.x - pos.x;
        dy = clickTarget.y - pos.y;
      }
    }
    const moving = dx !== 0 || dy !== 0;
    if (!moving) {
      walkMs = 0;
      return;
    }
    if (dx !== 0) dir = dx > 0 ? "right" : "left";
    if (dy !== 0 && dx === 0) dir = dy > 0 ? "down" : "up";
    const len = Math.hypot(dx, dy);
    const nx = pos.x + (dx / len) * SPEED * dt;
    const ny = pos.y + (dy / len) * SPEED * dt;
    // Standing inside a blocked rect (e.g. just stood up from an armchair)
    // moves freely so the player can always walk out.
    const stuck = isBlocked(pos.x, pos.y);
    const beforeX = pos.x;
    const beforeY = pos.y;
    if (stuck || !isBlocked(nx, pos.y)) pos.x = nx;
    if (stuck || !isBlocked(pos.x, ny)) pos.y = ny;
    // A click-walk that can't make progress (furniture in the way) gives up.
    if (clickTarget && pos.x === beforeX && pos.y === beforeY) clickTarget = null;
    walkMs += dt * 1000;
  }

  function drawNpc(npc: Npc, now: number) {
    const snap = npcSnapshot(npc.id);
    if (!snap) return;
    const h = npc.height;
    const w = (snap.width / snap.height) * h;
    const bob = reducedMotion ? 0 : Math.sin(now / 600 + (npc.id === "tim" ? 0 : 2)) * 3;
    const x0 = npc.at.x - w / 2;
    const y0 = npc.at.y - h + bob;
    if (highlighted?.kind === "npc" && highlighted.id === npc.id) {
      drawWithOutline(x0, y0, w, h, (c) => c.drawImage(snap, x0, y0, w, h));
    } else {
      ctx!.drawImage(snap, x0, y0, w, h);
    }
    if (markers.has(npc.id)) drawQuestMark(npc, now);
  }

  function drawQuestMark(npc: Npc, now: number) {
    const cell = 8;
    const gw = QUEST_GLYPH[0].length * cell;
    const gh = QUEST_GLYPH.length * cell;
    const bob = reducedMotion ? 0 : Math.sin(now / 350) * 5;
    const x0 = npc.at.x - gw / 2;
    // Sits above the NPC's name tag.
    const y0 = npc.at.y - npc.height - gh - 46 + bob;
    const paint = (color: string, ox: number, oy: number) => {
      ctx!.fillStyle = color;
      for (let r = 0; r < QUEST_GLYPH.length; r++) {
        for (let c = 0; c < QUEST_GLYPH[r].length; c++) {
          if (QUEST_GLYPH[r][c] === "1") {
            ctx!.fillRect(x0 + c * cell + ox, y0 + r * cell + oy, cell, cell);
          }
        }
      }
    };
    // Full dark outline so the gold pops against the tan floor.
    for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [3, 4]] as const) {
      paint("#083858", ox, oy);
    }
    paint("#FFD24A", 0, 0);
  }

  function avatarTopY(): number {
    const s = AVATAR_WORLD_HEIGHT / (SPRITE_VIEW.feetY - SPRITE_VIEW.bodyTop);
    return pos.y - SPRITE_VIEW.h * s;
  }

  function drawTag(text: string, worldX: number, worldTopY: number) {
    const { s, cx, cy } = camera();
    const sx = (worldX - cx) * s;
    const sy = (worldTopY - cy) * s;
    ctx!.save();
    ctx!.font = "700 12px ui-monospace, monospace";
    const padding = 7;
    const width = ctx!.measureText(text).width + padding * 2;
    const x = sx - width / 2;
    ctx!.fillStyle = "rgba(20, 18, 28, 0.72)";
    ctx!.beginPath();
    ctx!.roundRect(x, sy - 20, width, 20, 5);
    ctx!.fill();
    ctx!.fillStyle = "#fff";
    ctx!.textBaseline = "middle";
    ctx!.fillText(text, x + padding, sy - 10);
    ctx!.restore();
  }

  // Draws a player sprite (remote or local base pose) with feet at (x, y).
  function drawPlayerSpriteTo(c: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number) {
    const s = AVATAR_WORLD_HEIGHT / (SPRITE_VIEW.feetY - SPRITE_VIEW.bodyTop);
    const dw = SPRITE_VIEW.w * s;
    const dh = SPRITE_VIEW.h * s;
    c.drawImage(img, SPRITE_VIEW.x, SPRITE_VIEW.y, SPRITE_VIEW.w, SPRITE_VIEW.h, x - dw / 2, y - dh, dw, dh);
  }

  function drawPlayerSprite(img: HTMLCanvasElement, x: number, y: number) {
    drawPlayerSpriteTo(ctx!, img, x, y);
  }

  function remoteTopY(r: Remote): number {
    const s = AVATAR_WORLD_HEIGHT / (SPRITE_VIEW.feetY - SPRITE_VIEW.bodyTop);
    return r.ry - SPRITE_VIEW.h * s;
  }

  function drawNameTags() {
    if (playerName) drawTag(playerName, pos.x, avatarTopY() - 6);
    for (const npc of NPCS) {
      drawTag(npc.name, npc.at.x, npc.at.y - npc.height - 8);
    }
    for (const r of remotes.values()) {
      if (r.name) drawTag(r.name, r.rx, remoteTopY(r) - 6);
    }
  }

  function drawSpeech(now: number) {
    const { s, cx, cy } = camera();
    for (const [id, bubble] of speech) {
      if (bubble.until < now) {
        speech.delete(id);
        continue;
      }
      const npc = NPCS.find((n) => n.id === id)!;
      const sx = (npc.at.x - cx) * s;
      const sy = (npc.at.y - npc.height - 24 - cy) * s;
      ctx!.save();
      ctx!.font = "600 14px ui-monospace, monospace";
      const padding = 10;
      const width = Math.min(ctx!.measureText(bubble.text).width + padding * 2, 320);
      const x = Math.min(Math.max(sx - width / 2, 8), canvas.clientWidth - width - 8);
      ctx!.fillStyle = "rgba(20, 18, 28, 0.88)";
      ctx!.beginPath();
      ctx!.roundRect(x, sy - 34, width, 30, 6);
      ctx!.fill();
      ctx!.fillStyle = "#fff";
      ctx!.textBaseline = "middle";
      ctx!.fillText(bubble.text, x + padding, sy - 19, width - padding * 2);
      ctx!.restore();
    }
  }

  function draw(now: number) {
    // 1.5x is indistinguishable for chunky pixel art and much cheaper to fill.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.imageSmoothingEnabled = false;
    ctx!.fillStyle = "#17141f";
    ctx!.fillRect(0, 0, w, h);
    if (!baseImg.complete || baseImg.naturalWidth === 0) return;

    const { s, cx, cy } = camera();
    ctx!.save();
    ctx!.scale(s, s);
    ctx!.translate(-cx, -cy);
    ctx!.drawImage(baseImg, 0, 0);
    for (const it of INTERACTABLES) {
      if (!open.has(it.id)) continue;
      const img = overlayImgs.get(it.id)!;
      if (img.complete && img.naturalWidth > 0) ctx!.drawImage(img, it.overlay.x, it.overlay.y);
    }

    const entities: { y: number; draw: () => void }[] = NPCS.map((npc) => ({
      y: npc.at.y,
      draw: () => drawNpc(npc, now),
    }));
    for (const r of remotes.values()) {
      entities.push({
        y: r.ry,
        draw: () => {
          if (highlighted?.kind === "remote" && highlighted.id === r.id) {
            const s = AVATAR_WORLD_HEIGHT / (SPRITE_VIEW.feetY - SPRITE_VIEW.bodyTop);
            const dw = SPRITE_VIEW.w * s;
            const dh = SPRITE_VIEW.h * s;
            drawWithOutline(r.rx - dw / 2, r.ry - dh, dw, dh, (c) =>
              drawPlayerSpriteTo(c, r.sprites.open, r.rx, r.ry),
            );
          } else {
            drawPlayerSprite(r.sprites.open, r.rx, r.ry);
          }
        },
      });
    }
    entities.push({
      y: pos.y,
      draw: () => {
        // Scale by body height (crop bottom = feet) so the avatar matches the
        // NPC sprites instead of carrying the sheet's empty margins.
        const s = AVATAR_WORLD_HEIGHT / (SPRITE_VIEW.feetY - SPRITE_VIEW.bodyTop);
        const dw = SPRITE_VIEW.w * s;
        const dh = SPRITE_VIEW.h * s;
        // Blink: ~140ms every 2.2-5s, also while walking.
        const blinking = now >= nextBlinkAt && now < nextBlinkAt + 140;
        if (now >= nextBlinkAt + 140) nextBlinkAt = now + 2200 + Math.random() * 2800;
        const img = blinking ? avatarSprites.closed : avatarSprites.open;
        const moving = walkMs > 0;
        ctx!.save();
        if (dir === "left") {
          ctx!.translate(pos.x, 0);
          ctx!.scale(-1, 1);
          ctx!.translate(-pos.x, 0);
        }
        // Walking: a step-synced waddle (tilt around the feet) plus a bob.
        const bob = moving && !reducedMotion ? Math.abs(Math.sin(walkMs / 110)) * 6 : 0;
        const tilt = moving && !reducedMotion ? Math.sin(walkMs / 110) * 0.055 : 0;
        ctx!.translate(pos.x, pos.y);
        ctx!.rotate(tilt);
        ctx!.drawImage(
          img,
          SPRITE_VIEW.x,
          SPRITE_VIEW.y,
          SPRITE_VIEW.w,
          SPRITE_VIEW.h,
          -dw / 2,
          -dh + bob,
          dw,
          dh,
        );
        ctx!.restore();
      },
    });
    entities.sort((a, b) => a.y - b.y);
    for (const e of entities) e.draw();
    ctx!.restore();

    drawNameTags();
    drawSpeech(now);
  }

  let raf = 0;
  function tick(now: number) {
    if (destroyed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!paused) {
      move(dt);
      if (!dragging && walkMs > 0 && (panX !== 0 || panY !== 0)) {
        const k = Math.min(1, dt * 5);
        panX -= panX * k;
        panY -= panY * k;
        if (Math.abs(panX) < 0.5) panX = 0;
        if (Math.abs(panY) < 0.5) panY = 0;
      }
      const hint = hintFor(nearestHotspot(pos.x, pos.y));
      if (hint !== lastHint) {
        lastHint = hint;
        cb.onHint(hint);
      }
    }
    // Remote players glide toward their last reported position.
    for (const r of remotes.values()) {
      const k = Math.min(1, dt * 7);
      r.rx += (r.x - r.rx) * k;
      r.ry += (r.y - r.ry) * k;
    }
    draw(now);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
    },
    say(npc, text) {
      speech.set(npc, { text, until: performance.now() + 4200 });
    },
    setPaused(p) {
      paused = p;
      if (p) keys.clear();
    },
    setMarker(npc, on) {
      if (on) markers.add(npc);
      else markers.delete(npc);
    },
    setRemotePlayers(players) {
      const ids = new Set(players.map((p) => p.id));
      if (highlighted?.kind === "remote" && !ids.has(highlighted.id)) highlighted = null;
      for (const id of [...remotes.keys()]) {
        if (!ids.has(id)) remotes.delete(id);
      }
      for (const p of players) {
        const existing = remotes.get(p.id);
        if (existing) {
          existing.x = p.x;
          existing.y = p.y;
          existing.sprites = p.sprites;
          existing.name = p.name;
        } else {
          remotes.set(p.id, { ...p, rx: p.x, ry: p.y });
        }
      }
    },
    getPosition: () => ({ x: pos.x, y: pos.y }),
    clearHighlight() {
      highlighted = null;
    },
  };
}
