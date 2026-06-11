/**
 * The receipt hash chain. prevHash of a receipt is the SHA-256 of the prior
 * receipt body's JCS canonicalisation; the first receipt uses the literal
 * "genesis". Simulated receipts are chain links too (Suite E).
 *
 * The hash covers the signed body only - the detached signature is not part of
 * the canonical form (semantics section 4).
 */

import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { ReceiptBody, SignedReceipt } from '../types';

export const GENESIS = 'genesis';

/** Strip the detached signature fields, leaving the signed body. */
export function receiptBodyOf(receipt: ReceiptBody | SignedReceipt): ReceiptBody {
  const { sig, keyId, ...body } = receipt as SignedReceipt;
  void sig;
  void keyId;
  return body as ReceiptBody;
}

/** SHA-256 of the JCS canonicalisation of a receipt body, "sha256:"-prefixed. */
export function hashReceiptBody(body: ReceiptBody | SignedReceipt): string {
  const canonical = canonicalize(receiptBodyOf(body));
  if (canonical === undefined) {
    throw new Error('chain: receipt body is not canonicalisable');
  }
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${digest}`;
}
