/**
 * Context token (Interface 3, carriage half). A signed, base64url-encoded
 * record { decisionId, principal, action, decision, policyVersion, iat }
 * (Ed25519, the same key family as receipts). Serialised as
 * base64url(JCS(payload)) + "." + base64url(signature), per the spec's
 * ContextToken.
 *
 * A subsequent proposal may carry it as priorContext. The pipeline admits it to
 * policy input ONLY after the signature verifies (semantics section 5); a token
 * that fails verification is EXCLUDED (returned as null here) and the decision
 * reports contextTrusted: false - verification failure does not by itself deny.
 *
 * v0.1 carriage is within one runtime's trust domain only (the same signer
 * signs and verifies). Cross-domain, cross-engine carriage is out of scope.
 */

import canonicalize from 'canonicalize';
import type { ReceiptSigner } from '../state/receipts';
import type { PriorContext } from '../types';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signContextToken(signer: ReceiptSigner, ctx: PriorContext): string {
  const canonical = canonicalize(ctx);
  if (canonical === undefined) {
    throw new Error('context: token payload is not canonicalisable');
  }
  const payload = Buffer.from(canonical, 'utf8');
  const sig = signer.signDetached(payload);
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** Returns the decoded prior context if the signature verifies, else null. */
export function verifyContextToken(signer: ReceiptSigner, token: string): PriorContext | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0], 'base64url');
  const sig = Buffer.from(parts[1], 'base64url');
  if (!signer.verifyDetached(payload, sig)) return null;
  try {
    return JSON.parse(payload.toString('utf8')) as PriorContext;
  } catch {
    return null;
  }
}
