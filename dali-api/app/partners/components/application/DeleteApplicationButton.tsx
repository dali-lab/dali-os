import { Trash2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export function DeleteApplicationButton({
  applicationId,
  title,
  onDeleted,
}: {
  applicationId: string;
  title: string;
  onDeleted: () => void;
}) {
  const dialog = useDialog();

  async function confirmDelete() {
    const deleted = await dialog.confirm({
      title: `Delete “${title}”?`,
      description:
        "This removes the application from the pipeline for good, along with its meetings, notes and activity. Use Reject instead if the partner applied and was turned down.",
      confirmLabel: "Delete application",
      tone: "destructive",
      onConfirm: async () => {
        const result = await postPartnerApplicationIntent(applicationId, "delete");
        if (!result.ok) return result.error ?? "Couldn't delete this application.";
      },
    });
    if (deleted) onDeleted();
  }

  return <IconButton label="Delete application" icon={Trash2} tone="destructive" onClick={() => void confirmDelete()} />;
}
