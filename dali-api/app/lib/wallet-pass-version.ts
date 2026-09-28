// Wallet-pass design version. Bump this whenever the pass FACE changes (colors,
// fields, artwork) AND you want the change pushed to passes already saved on
// members' phones. On the next deploy the wallet-pass-release job sees a version
// with no WalletPassReleaseLog row, runs the restyle broadcast (Google REST patch
// + Apple re-push) once, and records it.
//
// New saves/downloads always get the current design regardless of this value —
// it only governs the one-time rollout to already-installed passes.
//
// "1" = the Domain / Class / Member-since / Core + deep-navy + block-band redesign.
export const WALLET_PASS_DESIGN_VERSION = "1";
