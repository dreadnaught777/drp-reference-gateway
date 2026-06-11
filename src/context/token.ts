/**
 * Context token (Interface 3, carriage half). A signed, base64url-encoded
 * record { decisionId, principal, action, decision, policyVersion, iat }
 * (Ed25519, same key family as receipts). A subsequent proposal may carry it
 * as priorContext. A valid token is exposed to policy input; an invalid or
 * tampered one sets contextTrusted: false and is EXCLUDED from policy input
 * (not auto-denied - semantics: verification failure does not by itself deny).
 *
 * M0 scaffold: signatures only. Gate: Suites H, I (M6).
 */

import type { PriorContext } from '../types';

export function signContextToken(_ctx: PriorContext): string {
  throw new Error('context token signing not implemented until M6');
}

/** Returns the decoded prior context if the signature verifies, else null. */
export function verifyContextToken(_token: string): PriorContext | null {
  throw new Error('context token verification not implemented until M6');
}
