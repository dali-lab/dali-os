import { Link, useFetcher } from "react-router";
import { X } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { LoadMore } from "~/components/ui/Pager";
import { RolePills } from "~/components/ui/RolePills";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";

export type MemberCardData = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  photoUrl: string | null;
  coreTitles: string[];
  domainRoles: { domainName: string; level: string }[];
  isCurrentMember: boolean;
};

export function GroupRoster({
  memberIds,
  membersById,
  removable,
  groupId,
}: {
  memberIds: string[];
  membersById: Map<string, MemberCardData>;
  removable: boolean;
  groupId: string;
}) {
  const { visible, pager } = useClientSlice(memberIds, { resetKey: groupId });
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {visible.map((uid) => {
          const m = membersById.get(uid);
          if (!m) {
            return (
              <div
                key={uid}
                className={cn(
                  "p-2 bg-os-bg dark:bg-os-card text-xs text-muted-foreground",
                  "rounded-os-item",
                )}
              >
                Unknown member
              </div>
            );
          }
          return <ExpandedMemberCard key={uid} member={m} removable={removable} groupId={groupId} />;
        })}
      </div>
      <LoadMore {...pager} />
    </>
  );
}

function ExpandedMemberCard({
  member,
  removable,
  groupId,
}: {
  member: MemberCardData;
  removable: boolean;
  groupId: string;
}) {
  const fetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  return (
    <div
      className={cn(
        // On the open group's accent wash the card plane vanishes (the wash is
        // mixed from os-card), so these sit a plane up: white in light, where
        // the ramp inverts; os-card in dark, where card is already the top.
        "relative p-2 bg-os-bg dark:bg-os-card flex items-start gap-2 hover:bg-os-card-hover transition-colors",
        "rounded-os-item",
      )}
    >
      <Link to={`/members/${member.id}`} className="flex items-start gap-2 min-w-0 flex-1">
        <Avatar photoUrl={member.photoUrl} name={fullName} size="sm" className="flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{fullName}</div>
          <div className="mt-1">
            {member.coreTitles.length === 0 && member.domainRoles.length === 0 ? (
              <span className="text-muted-foreground text-xs">—</span>
            ) : (
              <RolePills
                coreTitles={member.coreTitles}
                domainRoles={member.domainRoles}
                size="sm"
                showLevel
              />
            )}
          </div>
        </div>
      </Link>
      {removable && (
        <fetcher.Form
          method="post"
          className="flex-shrink-0"
          onSubmit={confirmSubmit({
            title: `Remove ${fullName} from this group?`,
            description:
              "They lose anything shared with the group — document shares and scheduling audiences that name it. You can add them back.",
            confirmLabel: "Remove",
            tone: "destructive",
          })}
        >
          <input type="hidden" name="intent" value="remove-member" />
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="userId" value={member.id} />
          <Tooltip content={`Remove ${fullName} from group`}>
            <button
              type="submit"
              aria-label={`Remove ${fullName} from group`}
              className="text-muted-foreground hover:text-destructive p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </Tooltip>
        </fetcher.Form>
      )}
    </div>
  );
}
