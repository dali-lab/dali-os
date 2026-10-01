// The Gmail views the Email tab can list. Client-safe. An empty query is
// Gmail's "all mail", which leaves Spam and Trash out; those two have to be
// asked for by name.
export const MAIL_FOLDERS = [
  { key: "inbox", label: "Inbox", query: "in:inbox", spamTrash: false },
  { key: "sent", label: "Sent", query: "in:sent", spamTrash: false },
  { key: "all", label: "All mail", query: "", spamTrash: false },
  { key: "spam", label: "Spam", query: "in:spam", spamTrash: true },
  { key: "trash", label: "Trash", query: "in:trash", spamTrash: true },
] as const;

export type MailFolder = (typeof MAIL_FOLDERS)[number];
export type MailFolderKey = MailFolder["key"];

export function mailFolder(key: string | null): MailFolder {
  return MAIL_FOLDERS.find((f) => f.key === key) ?? MAIL_FOLDERS[0];
}

// A search from the Inbox looks through all mail, as it always has. From any
// other folder it stays inside that folder.
export function folderQuery(folder: MailFolder, search: string): string {
  if (!search) return folder.query;
  return folder.key === "inbox" ? search : `${folder.query} ${search}`.trim();
}
