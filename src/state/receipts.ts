/**
 * Receipts: JCS-canonicalised (RFC 8785), SHA-256 hashed, Ed25519 detached
 * signature carried alongside the body, chained by prevHash. The first receipt
 * uses the literal "genesis". Receipts verify offline against the key at
 * GET /v1/keys.
 *
 * M0 scaffold: signature only. Gate: Suite C (M2).
 */

import type { ReceiptBody, SignedReceipt } from '../types';

export function signReceipt(_body: ReceiptBody): SignedReceipt {
  throw new Error('receipt signing not implemented until M2');
}
