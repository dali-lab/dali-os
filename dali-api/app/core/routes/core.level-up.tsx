import { useEffect, useState } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/core.level-up";
import { coreHandle } from "~/core/coreNav";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { canManageStaffing } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { applyEligibilityWithNotify } from "~/admin/lib/eligibility.server";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { buttonClasses } from "~/components/ui/Button";
import { Modal, ModalHeader } from "~/components/Modal";
import { loadSlotBoard, slotBoardAction } from "~/projects/lib/slot-board-page.server";
import { StaffingBoardPage } from "~/projects/components/StaffingBoardPage";
import { isLevel, type Level } from "~/lib/level";

const SLOT = "level-up" as const;

export const handle = coreHandle(SLOT);

export const meta: Route.MetaFunction = () => [{ title: "Level Up · DALI OS" }];

// Parses a level string to Level enum. Accepts "P1"/"P2"/"P3" and their full
// names "Learner"/"Doer"/"Mentor" (case-insensitive).
function parseLevel(raw: string): Level | null {
  const s = raw.trim().toLowerCase();
  if (s === "p1" || s === "learner") return "P1";
  if (s === "p2" || s === "doer") return "P2";
  if (s === "p3" || s === "mentor") return "P3";
  return null;
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, ["term"]);
}

export async function loader({ request }: Route.LoaderArgs) {
  return loadSlotBoard(request, SLOT, {
    enrichRows: async (rows, { cycleIds, binding }) => {
      const targetPromotion = await resolveTargetPromotions(
        rows.map((r) => r.userId),
        cycleIds,
        binding,
      );
      return rows.map((r) => ({ ...r, targetPromotion: targetPromotion.get(r.userId) ?? null }));
    },
  });
}

export type TargetPromotion = {
  domainId: string;
  domainName: string;
  targetLevel: Level;
  alreadyPromoted: boolean;
} | null;

// Resolves target domain + level for each user from their raw form submission.
// Returns null for rows where the mapping doesn't have target-domain /
// target-level, or the answers can't be resolved.
async function resolveTargetPromotions(
  userIds: string[],
  cycleIds: string[],
  binding: Awaited<ReturnType<typeof getSlotBinding>>,
): Promise<Map<string, TargetPromotion>> {
  const result = new Map<string, TargetPromotion>();
  if (!binding?.mapping || userIds.length === 0) return result;

  const domainEntry = binding.mapping.entries.find(
    (e) => e.role === "target-domain" && e.source === "question",
  );
  const levelEntry = binding.mapping.entries.find(
    (e) => e.role === "target-level" && e.source === "question",
  );
  if (!domainEntry || !levelEntry) return result;

  const domainKey =
    domainEntry.source === "question" ? domainEntry.questionKey : null;
  const levelKey =
    levelEntry.source === "question" ? levelEntry.questionKey : null;
  if (!domainKey || !levelKey) return result;

  const subs = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { in: cycleIds },
      slot: SLOT,
      userId: { in: userIds },
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, answers: true },
  });

  // Most recent submission per user.
  const seen = new Set<string>();
  const rawByUser = new Map<string, Record<string, unknown>>();
  for (const s of subs) {
    if (!s.userId || seen.has(s.userId)) continue;
    seen.add(s.userId);
    rawByUser.set(s.userId, (s.answers as Record<string, unknown>) ?? {});
  }

  // Batch-resolve domain ids + names. We try treating the raw answer as a
  // domain ID first; if that misses we fall back to displayName matching.
  const rawDomainAnswers = [...rawByUser.values()]
    .map((a) => a[domainKey])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const uniqueAnswers = [...new Set(rawDomainAnswers)];

  const byId = await prisma.domain.findMany({
    where: { id: { in: uniqueAnswers } },
    select: { id: true, displayName: true },
  });
  const byName = await prisma.domain.findMany({
    where: {
      displayName: {
        in: uniqueAnswers.filter((a) => !byId.find((d) => d.id === a)),
        mode: "insensitive",
      },
    },
    select: { id: true, displayName: true },
  });
  const domainLookup = new Map<string, { id: string; displayName: string }>();
  for (const d of [...byId, ...byName]) {
    domainLookup.set(d.id, d);
    domainLookup.set(d.displayName.toLowerCase(), d);
  }

  // Current eligibility levels per user so we can flag already-promoted rows.
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, domainId: true, level: true },
  });
  type EligKey = `${string}:${string}`;
  const currentLevel = new Map<EligKey, Level>();
  for (const e of eligibilities) {
    currentLevel.set(`${e.userId}:${e.domainId}`, e.level);
  }

  const LEVEL_ORDER: Record<Level, number> = { P1: 1, P2: 2, P3: 3 };

  for (const userId of userIds) {
    const answers = rawByUser.get(userId);
    if (!answers) {
      result.set(userId, null);
      continue;
    }
    const rawDomain = answers[domainKey];
    const rawLevel = answers[levelKey];
    if (typeof rawDomain !== "string" || typeof rawLevel !== "string") {
      result.set(userId, null);
      continue;
    }
    const domain =
      domainLookup.get(rawDomain) ??
      domainLookup.get(rawDomain.toLowerCase());
    const targetLevel = parseLevel(rawLevel);
    if (!domain || !targetLevel) {
      result.set(userId, null);
      continue;
    }
    const existing = currentLevel.get(`${userId}:${domain.id}`);
    const alreadyPromoted = Boolean(
      existing && LEVEL_ORDER[existing] >= LEVEL_ORDER[targetLevel],
    );
    result.set(userId, {
      domainId: domain.id,
      domainName: domain.displayName,
      targetLevel,
      alreadyPromoted,
    });
  }

  return result;
}

export async function action({ request }: Route.ActionArgs) {
  return slotBoardAction(request, SLOT, {
    extraIntent: async (intent, { form, userId }) => {
      if (intent !== "level-up-member") return null;
      if (!(await canManageStaffing(userId)))
        return Response.json({ error: "Forbidden" }, { status: 403 });
      const targetUserId = String(form.get("userId") ?? "");
      const domainId = String(form.get("domainId") ?? "");
      const targetLevel = String(form.get("targetLevel") ?? "");
      if (!targetUserId || !domainId || !isLevel(targetLevel))
        return Response.json({ error: "Invalid parameters." }, { status: 400 });
      await applyEligibilityWithNotify({
        userId: targetUserId,
        domainId,
        level: targetLevel,
        actorId: userId,
      });
      return Response.json({ ok: true });
    },
  });
}

type LevelUpTarget = {
  userId: string;
  name: string;
  domainId: string;
  domainName: string;
  targetLevel: Level;
};

export default function LevelUpDatabase() {
  const data = useLoaderData<typeof loader>();
  const [confirmRow, setConfirmRow] = useState<LevelUpTarget | null>(null);
  const tableProps =
    data.gate === "ok" && data.canManage
      ? {
          drawerFooter: (r: TableRow) => <LevelUpAction row={r} onLevelUp={setConfirmRow} />,
          trailing: [
            {
              key: "actions",
              label: "Actions",
              cell: (r: TableRow) => <LevelUpAction row={r} onLevelUp={setConfirmRow} />,
            },
          ],
        }
      : undefined;

  return (
    <StaffingBoardPage
      data={data}
      slot={SLOT}
      label="Level Up"
      emptyLabel="Level Up"
      tableProps={tableProps}
    >
      {confirmRow && <LevelUpConfirmDialog row={confirmRow} onClose={() => setConfirmRow(null)} />}
    </StaffingBoardPage>
  );
}

type LoadedData = Extract<Awaited<ReturnType<typeof loader>>, { gate: "ok" }>;
type TableRow = LoadedData["submissions"][number];

function LevelUpAction({
  row,
  onLevelUp,
}: {
  row: TableRow;
  onLevelUp: (row: LevelUpTarget) => void;
}) {
  const tp = row.targetPromotion;
  if (!tp) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Map target-domain and target-level columns to enable this button"
      >
        —
      </span>
    );
  }
  if (tp.alreadyPromoted) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-os-green/10 text-os-green border border-os-green/30"
        title={`Already at ${tp.targetLevel} in ${tp.domainName}`}
      >
        Promoted ✓
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        onLevelUp({
          userId: row.userId,
          name: row.name,
          domainId: tp.domainId,
          domainName: tp.domainName,
          targetLevel: tp.targetLevel,
        })
      }
      className={buttonClasses("primary", "xs")}
    >
      Level Up → {tp.targetLevel}
    </button>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function LevelUpConfirmDialog({
  row,
  onClose,
}: {
  row: {
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  };
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { ok?: boolean }).ok) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="level-up-confirm-title"
      disableEscape={pending}
      containerClassName="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-6 flex flex-col gap-4 my-auto"
    >
      <>
        <ModalHeader
          titleId="level-up-confirm-title"
          title="Confirm Level Up"
          onClose={onClose}
          className="mb-0"
        />
        <p className="text-sm text-foreground">
          Promote{" "}
          <span className="font-semibold">{row.name}</span> to{" "}
          <span className="font-semibold">{row.targetLevel}</span> in{" "}
          <span className="font-semibold">{row.domainName}</span>?
        </p>
        {fetcher.data && !(fetcher.data as { ok?: boolean }).ok && (
          <p className="text-sm text-os-red">
            {(fetcher.data as { error?: string }).error ?? "Something went wrong."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="level-up-member" />
            <input type="hidden" name="userId" value={row.userId} />
            <input type="hidden" name="domainId" value={row.domainId} />
            <input type="hidden" name="targetLevel" value={row.targetLevel} />
            <button
              type="submit"
              disabled={pending}
              className={buttonClasses("primary", "sm")}
            >
              {pending ? "Promoting…" : "Confirm"}
            </button>
          </fetcher.Form>
        </div>
      </>
    </Modal>
  );
}
