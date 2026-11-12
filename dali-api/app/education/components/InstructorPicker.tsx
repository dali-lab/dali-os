import { useState } from "react";
import { PersonPicker } from "~/components/ui/PersonPicker";

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
    <PersonPicker
      mode="multi"
      name="userIds"
      people={candidates}
      values={selectedIds}
      onChange={setSelectedIds}
      ariaLabel="Instructors"
      placeholder="Add instructors"
      searchPlaceholder="Search members by name"
      noMatchesLabel="No members match that name."
    />
  );
}
