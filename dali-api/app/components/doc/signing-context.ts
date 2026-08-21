// Mode-aware context for the signing field family + merge variables.
// Successor of SigningFieldCtx (app/components/editor/signing-fields.tsx),
// same semantics:
//   author -> static pill naming the placeable field (field config is doc state)
//   fill   -> interactive input for the signer's own role, read-only otherwise
//   view   -> baked/captured value, or a typed captioned placeholder if unfilled
//
// Fill values live in HOST React state (values / onFieldChange), never in the
// document. The spike proved React context propagation reaches BlockNote's
// inline node views across renders AND across editable-invariant transitions
// (fill<->view), so hosts just re-render the provider — no remount tricks.

import { createContext } from "react";

export type SigningMode = "author" | "fill" | "view";

export interface SigningContextValue {
  mode: SigningMode;
  /** fill: the role whose fields are interactive for this signer. */
  signerRole?: string;
  /** variable name -> resolved value (e.g. term "26S", today's date). */
  variables?: Record<string, string>;
  /** fieldId -> captured value; read source in view / other-role rendering. */
  values?: Record<string, unknown>;
  /** fill: report a value change up to the host (kept in React state there). */
  onFieldChange?: (fieldId: string, value: unknown) => void;
}

export const DEFAULT_SIGNING_CTX: SigningContextValue = { mode: "view" };

export const SigningContext = createContext<SigningContextValue>(DEFAULT_SIGNING_CTX);
