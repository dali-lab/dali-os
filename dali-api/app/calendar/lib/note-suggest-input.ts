import type { FilingSuggestionInput } from "~/calendar/components/MeetingNoteFields";
import type { EditContext } from "~/calendar/components/EditMeetingModal";

/** The filing-suggestion input for a meeting that already exists, read from its edit context. */
export function suggestInputOfMeeting({ meeting, options, viewer }: EditContext): FilingSuggestionInput {
  const group = meeting.scopeType === "Group" && meeting.groupId ? options.groups.find((g) => g.id === meeting.groupId) : undefined;
  const members = new Set(group?.memberIds ?? []);
  const invitedBeyondGroup = meeting.participantUserIds.some((id) => !members.has(id));
  return {
    attendeeIds: meeting.participantUserIds,
    groups: options.groups,
    invitedGroups: group ? [group] : [],
    scopeGroupId: group && !invitedBeyondGroup ? group.id : null,
    viewerId: viewer.userId,
    mentorPairs: options.mentorPairs ?? [],
  };
}
