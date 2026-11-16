import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { createLabScene, type LabScene, type RemotePlayerState } from "./scene";
import { QuestPhone } from "./QuestPhone";
import { DialogueBox, type DialogueSpec } from "./DialogueBox";
import { buildAvatarSprite, type AvatarConfig, type AvatarSprites } from "./pixel-avatar";
import { ART, AVATAR_ASSETS } from "./assets";
import { questPercent, type QuestProfile } from "./quest";
import { LAB_SERVERS, SERVER_CAPACITY, serverStatus, type LabServerId } from "./servers";
import "./alumni-game.css";

const LORIE_LINES = [
  "Welcome back! The lab hasn't been the same without you.",
  "Tim's got a quest for you. Look for the yellow question mark.",
  "The fridge is fair game. The pizza... you should check.",
  "Try the pods! APPA and MOMO are the best focus spots.",
];

export function LabSceneView({
  avatar,
  playerName,
  profile: initialProfile,
  questAccepted: initiallyAccepted,
  chatLog,
}: {
  avatar: AvatarConfig;
  playerName: string;
  profile: QuestProfile;
  questAccepted: boolean;
  chatLog: { from: "tim" | "you"; text: string }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<LabScene | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [flavor, setFlavor] = useState<string | null>(null);
  const flavorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [accepted, setAccepted] = useState(initiallyAccepted);
  const [profile, setProfile] = useState(initialProfile);
  const [sprite, setSprite] = useState<AvatarSprites | null>(null);
  const [dialogue, setDialogue] = useState<DialogueSpec | null>(null);
  const [log, setLog] = useState(chatLog);
  const appendMessages = (ms: { from: "tim" | "you"; text: string }[]) =>
    setLog((prev) => [...prev, ...ms]);
  const [server, setServer] = useState<LabServerId>("lab-1");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const lastGoodServer = useRef<LabServerId>("lab-1");
  const spriteCache = useRef(new Map<string, AvatarSprites>());
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const percent = questPercent(profile);

  async function acceptQuest() {
    setDialogue(null);
    try {
      const res = await fetch("/api/alumni-game/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "accept" }),
      });
      const data = (await res.json().catch(() => null)) as {
        messages?: { from: "tim" | "you"; text: string }[];
      } | null;
      if (data?.messages) appendMessages(data.messages);
    } catch {
      // The phone's own fallback greeting covers a failed accept call.
    }
    setAccepted(true);
    setPhoneOpen(true);
  }

  function timDialogue(): DialogueSpec {
    const portrait = ART["npc-tim.gif"];
    const first = playerName || "there";
    if (questPercent(profileRef.current) >= 100) {
      return {
        name: "Tim",
        portrait,
        lines: [
          "your profile is all set!  thanks for all your efforts!!",
          "so great to have you back around the lab",
        ],
      };
    }
    if (acceptedRef.current) {
      return {
        name: "Tim",
        portrait,
        lines: ["ready to pick up where we left off?"],
        choices: [
          { label: "open the phone", onPick: () => { setDialogue(null); setPhoneOpen(true); } },
          { label: "later!", onPick: () => setDialogue(null) },
        ],
      };
    }
    return {
      name: "Tim",
      portrait,
      lines: [
        `hi ${first}!  I wanted to reach out and welcome you back to DALI!`,
        "thanks for all your efforts over the years!!",
        "tell me how you have been!  and let me know what your hopes and dreams are!",
      ],
      choices: [
        { label: "sure, let's catch up!", onPick: acceptQuest },
        { label: "maybe later", onPick: () => setDialogue(null) },
      ],
    };
  }

  useEffect(() => {
    let cancelled = false;
    buildAvatarSprite(avatar, AVATAR_ASSETS)
      .then((built) => {
        if (!cancelled) setSprite(built);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Avatar identity is stable for the visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) return;
    const scene = createLabScene(
      canvas,
      {
        base: ART["lab-base.png"],
        overlays: {
          fridge: ART["fridge-open.png"],
          "cabinet-1": ART["cabinet-open-1.png"],
          "cabinet-2": ART["cabinet-open-2.png"],
          pizza: ART["pizza-open.png"],
          "pod-appa": ART["pod-door-1.png"],
          "pod-momo": ART["pod-door-2.png"],
        },
        npcs: { tim: ART["npc-tim.gif"], lorie: ART["npc-lorie.gif"] },
      },
      sprite,
      playerName,
      {
        onHint: setHint,
        onFlavor: (text) => {
          setFlavor(text);
          clearTimeout(flavorTimer.current);
          flavorTimer.current = setTimeout(() => setFlavor(null), 3800);
        },
        onNpc: (id) => {
          if (id === "tim") {
            setDialogue(timDialogue());
          } else {
            setDialogue({ name: "Lorie", portrait: ART["npc-lorie.gif"], lines: LORIE_LINES });
          }
        },
      },
    );
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
    // The scene owns its own loop; it mounts once the sprite is built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite]);

  useEffect(() => {
    sceneRef.current?.setPaused(phoneOpen || dialogue !== null);
  }, [phoneOpen, dialogue]);

  // Tim carries the quest "?" until the player accepts.
  useEffect(() => {
    sceneRef.current?.setMarker("tim", !accepted);
  }, [accepted, sprite]);

  // Presence heartbeat: reports our position, learns everyone else's on this
  // server, and keeps the per-server head counts fresh.
  useEffect(() => {
    if (!sprite) return;
    let cancelled = false;
    const tick = async () => {
      const scene = sceneRef.current;
      if (!scene) return;
      try {
        const res = await fetch("/api/alumni-game/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ server, avatar, ...scene.getPosition() }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          counts?: Record<string, number>;
          players?: { id: string; name: string; avatar: AvatarConfig; x: number; y: number }[];
        } | null;
        if (cancelled || !data) return;
        if (data.counts) setCounts(data.counts);
        if (res.status === 409) {
          setServer(lastGoodServer.current);
          return;
        }
        if (!data.ok || !data.players) return;
        lastGoodServer.current = server;
        const players: RemotePlayerState[] = [];
        for (const p of data.players) {
          const key = JSON.stringify(p.avatar);
          let sprites = spriteCache.current.get(key);
          if (!sprites) {
            sprites = await buildAvatarSprite(p.avatar, AVATAR_ASSETS);
            spriteCache.current.set(key, sprites);
          }
          players.push({ id: p.id, name: p.name, sprites, x: p.x, y: p.y });
        }
        if (!cancelled) sceneRef.current?.setRemotePlayers(players);
      } catch {
        // Offline heartbeat: try again next tick.
      }
    };
    tick();
    const timer = setInterval(tick, 600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // avatar identity is stable for the visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite, server]);

  useEffect(
    () => () => {
      navigator.sendBeacon?.(
        "/api/alumni-game/presence",
        new Blob([JSON.stringify({ intent: "leave" })], { type: "application/json" }),
      );
    },
    [],
  );

  return (
    <div className="ag-lab">
      <canvas ref={canvasRef} className="ag-lab-canvas" />
      <div className="ag-lab-topbar">
        <Link to="/" className="ag-lab-exit">
          ← Leave the lab
        </Link>
      </div>
      <div className="ag-lab-bottomleft">
        <div className="ag-server-panel" role="radiogroup" aria-label="Lab server">
          {LAB_SERVERS.map((s) => {
            const count = counts[s.id] ?? 0;
            const status = serverStatus(count);
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === server}
                data-active={s.id === server || undefined}
                disabled={s.id !== server && status === "full"}
                onClick={() => {
                  if (s.id === server) return;
                  sceneRef.current?.setRemotePlayers([]);
                  setServer(s.id);
                }}
              >
                <i className="ag-server-dot" data-status={status} />
                {s.label}
                <em>
                  {count}/{SERVER_CAPACITY}
                </em>
              </button>
            );
          })}
        </div>
        <span className="ag-lab-keys">Click to move and interact · scroll to zoom · drag with the scroll wheel to look around</span>
      </div>
      {flavor && !phoneOpen && !dialogue ? (
        <div className="ag-lab-hint ag-lab-hint--flavor">{flavor}</div>
      ) : hint && !phoneOpen && !dialogue ? (
        <div className="ag-lab-hint">{hint}</div>
      ) : null}
      {accepted && percent < 100 ? (
        <button type="button" className="ag-quest-tracker" onClick={() => setPhoneOpen(true)}>
          <span className="ag-quest-tracker-mark">?</span>
          <span className="ag-quest-tracker-label">
            Tim's onboarding quest
            <span className="ag-quest-tracker-bar">
              <i style={{ width: `${percent}%` }} />
            </span>
          </span>
        </button>
      ) : null}
      {dialogue && !phoneOpen ? (
        <DialogueBox
          spec={dialogue}
          onClose={() => {
            setDialogue(null);
            sceneRef.current?.clearHighlight();
          }}
        />
      ) : null}
      {phoneOpen ? (
        <QuestPhone
          profile={profile}
          accepted={accepted}
          messages={log}
          appendMessages={appendMessages}
          onAccepted={() => setAccepted(true)}
          onProfileChange={setProfile}
          onClose={() => setPhoneOpen(false)}
        />
      ) : null}
    </div>
  );
}
