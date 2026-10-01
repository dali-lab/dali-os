// The risk notice a member agrees to before connecting their personal DALI
// mailbox. Client-safe. Bump the version whenever the wording changes in
// substance: consent is recorded against it, so a new version asks everyone
// to agree again before their next connect.
export const PERSONAL_MAIL_NOTICE_VERSION = "2026-10-01";

export const PERSONAL_MAIL_NOTICE = [
  "Connecting your personal DALI mailbox is voluntary. If you connect it, DALI OS will read, display, change and send mail in that mailbox on your behalf. Message content may be processed by third-party services that DALI OS relies on, including Google, hosting providers and AI features.",
  "This integration is provided as is and as available, without warranties of any kind, express or implied, including as to security, confidentiality or availability. To the fullest extent permitted by applicable law, the DALI Lab and its staff, members and affiliates disclaim all liability for any unauthorized access to, disclosure of, alteration of or loss of data in or from a mailbox you choose to connect, and for any resulting damages.",
  "You remain solely responsible for the contents of your mailbox and for complying with the institutional policies and laws that apply to it. You may disconnect at any time from Inboxes, which stops further access by DALI OS.",
] as const;

export const PERSONAL_MAIL_CONSENT_LABEL =
  "I have read and understood this notice, and I choose to connect my personal DALI mailbox at my own risk.";
