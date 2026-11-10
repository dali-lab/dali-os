import { useState } from "react";
import { Avatar } from "~/components/ui/Avatar";
import { MultiSelect } from "~/components/ui/floating";

export type InstructorCandidate = { id: string; name: string };

export function InstructorPicker({
  candidates,
  initialSelectedIds,
}: {
  candidates: InstructorCandidate[];
  initialSelectedIds: string[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

  return (
    <MultiSelect
      name="userIds"
      values={selectedIds}
      onChange={setSelectedIds}
      options={candidates.map((c) => ({
        value: c.id,
        label: c.name,
        icon: <Avatar name={c.name} size="xs" />,
      }))}
      searchable
      ariaLabel="Instructors"
      placeholder="Add instructors"
      searchPlaceholder="Search members by name"
      noMatchesLabel="No members match that name."
    />
  );
}
