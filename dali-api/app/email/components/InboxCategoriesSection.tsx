import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Pencil, Plus, Trash2, UsersRound, X } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { MultiSelect } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { EMAIL_RE, MAX_CATEGORY_DESCRIPTION, MAX_CATEGORY_NAME } from "~/email/lib/categories";
import type { loadInboxCategories } from "~/email/lib/categories.server";

type ActionResult = { ok?: boolean; error?: string };
export type InboxCategoryData = Awaited<ReturnType<typeof loadInboxCategories>>;
type Category = InboxCategoryData["categories"][number];

function CategoryModal({
  category,
  data,
  onClose,
}: {
  category: Category | null;
  data: InboxCategoryData;
  onClose: () => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
  const [inboxes, setInboxes] = useState<string[]>(category?.inboxes.map((i) => i.address) ?? []);
  const [draftAddress, setDraftAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [userIds, setUserIds] = useState<string[]>(category?.audienceUserIds ?? []);
  const [groupIds, setGroupIds] = useState<string[]>(category?.audienceGroupIds ?? []);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  // Inboxes other categories already use, offered for one-click reuse.
  const suggestions = useMemo(
    () =>
      [...new Set(data.categories.flatMap((c) => c.inboxes.map((i) => i.address)))]
        .filter((a) => !inboxes.includes(a))
        .sort(),
    [data.categories, inboxes],
  );

  const addAddress = () => {
    const address = draftAddress.trim().toLowerCase();
    if (!address) return;
    if (!EMAIL_RE.test(address)) {
      setAddressError(`${address} isn't a valid email address.`);
      return;
    }
    setInboxes((xs) => (xs.includes(address) ? xs : [...xs, address]));
    setDraftAddress("");
    setAddressError(null);
  };

  const submit = (form: HTMLFormElement) => {
    const body = new FormData(form);
    body.set("intent", "save-category");
    if (category) body.set("id", category.id);
    // An address typed but not yet added still counts — Save shouldn't drop it.
    const pending = draftAddress.trim().toLowerCase();
    [...inboxes, ...(EMAIL_RE.test(pending) ? [pending] : [])].forEach((a) => body.append("inbox", a));
    userIds.forEach((id) => body.append("userId", id));
    groupIds.forEach((id) => body.append("groupId", id));
    fetcher.submit(body, { method: "post" });
  };

  return (
    <Modal open onClose={onClose} labelledBy="mail-category-title" containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader
        titleId="mail-category-title"
        title={category ? `Edit ${category.name}` : "New category"}
        onClose={onClose}
      />
      <form
        className={cn(formClass, "flex flex-col gap-4")}
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <label className={fieldLabel}>
          Name
          <input type="text" name="name" required maxLength={MAX_CATEGORY_NAME} defaultValue={category?.name ?? ""} placeholder="Partnerships" />
        </label>
        <label className={fieldLabel}>
          Description
          <textarea
            name="description"
            rows={2}
            maxLength={MAX_CATEGORY_DESCRIPTION}
            defaultValue={category?.description ?? ""}
            placeholder="What these inboxes are for"
          />
        </label>

        <div className={fieldLabel}>
          Inboxes
          {inboxes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {inboxes.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full bg-os-container py-0.5 pl-2.5 pr-1 text-xs text-foreground"
                >
                  {a}
                  <IconButton
                    label={`Remove ${a}`}
                    icon={X}
                    className="p-0.5"
                    iconClassName="h-3 w-3"
                    onClick={() => setInboxes((xs) => xs.filter((x) => x !== a))}
                  />
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="email"
              aria-label="Add an inbox address"
              placeholder="partners@dali.dartmouth.edu"
              value={draftAddress}
              onChange={(e) => {
                setDraftAddress(e.target.value);
                setAddressError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAddress();
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button type="button" variant="secondary" size="sm" onClick={addAddress}>
              Add
            </Button>
          </div>
          {addressError && <span className="text-xs text-destructive">{addressError}</span>}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">In other categories:</span>
              {suggestions.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setInboxes((xs) => [...xs, a])}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-foreground hover:bg-os-hover"
                >
                  <Plus className="h-3 w-3" />
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={fieldLabel}>
          Who can subscribe
          <MultiSelect
            ariaLabel="Groups who can subscribe"
            values={groupIds}
            options={data.groups.map((g) => ({ value: g.id, label: g.name }))}
            onChange={setGroupIds}
            placeholder="No groups"
            buttonClassName={formTrigger}
          />
          <MultiSelect
            ariaLabel="People who can subscribe"
            values={userIds}
            options={data.members.map((m) => ({ value: m.id, label: m.name, description: m.email ?? undefined }))}
            onChange={setUserIds}
            placeholder="No individual people"
            buttonClassName={formTrigger}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          People in this audience choose to subscribe from their Email tab, then sign in to each inbox themselves.
        </p>
        {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
        <ModalFooter onCancel={onClose} className="mt-2">
          <Button type="submit" size="sm" disabled={busy}>
            {category ? "Save" : "Create"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// The shared-inbox category list on Admin → Email Senders.
export function InboxCategoriesSection({ data, canEdit }: { data: InboxCategoryData; canEdit: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const { card, cardPad, bodyText, sectionTitle } = useOsChrome();
  // null = closed, "new" = create, else the category being edited.
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  const memberName = new Map(data.members.map((m) => [m.id, m.name]));
  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  const audienceOf = (c: Category) => [
    ...c.audienceGroupIds.map((id) => groupName.get(id)).filter(Boolean),
    ...c.audienceUserIds.map((id) => memberName.get(id)).filter(Boolean),
  ];

  const remove = async (c: Category) => {
    const ok = await dialog.confirm({
      title: `Delete ${c.name}?`,
      description:
        c.subscribers > 0
          ? `${c.subscribers} subscriber${c.subscribers === 1 ? "" : "s"} lose these inboxes from their Email tab.`
          : undefined,
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (ok) fetcher.submit({ intent: "delete-category", id: c.id }, { method: "post" });
  };

  return (
    <section id="inbox-categories" className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        <h2 className={sectionTitle}>Categories</h2>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" />
            New category
          </Button>
        )}
      </header>
      <p className={bodyText}>
        Each category holds shared inboxes and the people or groups who can subscribe to them. Subscribers sign in
        to each inbox themselves from their Email tab. Everyone already gets their DALI inbox and their current
        project&apos;s inbox automatically.
      </p>
      {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}

      {data.categories.length === 0 ? (
        <div className={cn(card, cardPad, "text-sm text-muted-foreground")}>
          No categories yet.{canEdit ? " Create one to share inboxes with the lab." : ""}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.categories.map((c) => {
            const audience = audienceOf(c);
            return (
              <div key={c.id} className={cn(card, cardPad, "flex flex-col gap-3")}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{c.name}</p>
                    {c.description && <p className="mt-0.5 text-sm text-muted-foreground">{c.description}</p>}
                  </div>
                  <span className="shrink-0 pt-1 text-xs text-muted-foreground">
                    {c.subscribers} subscribed
                  </span>
                  {canEdit && (
                    <>
                      <IconButton label={`Edit ${c.name}`} icon={Pencil} onClick={() => setEditing(c)} />
                      <IconButton label={`Delete ${c.name}`} icon={Trash2} tone="destructive" onClick={() => remove(c)} />
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.inboxes.length === 0 ? (
                    canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        Add inboxes
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">No inboxes</span>
                    )
                  ) : (
                    c.inboxes.map((i) => (
                      <span key={i.id} className="rounded-full bg-os-container px-2.5 py-0.5 text-xs text-foreground">
                        {i.address}
                        <span className="ml-1.5 text-muted-foreground">{i.signedIn} signed in</span>
                      </span>
                    ))
                  )}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UsersRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {audience.length === 0 ? "Nobody can subscribe yet" : audience.join(", ")}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CategoryModal
          category={editing === "new" ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
