/**
 * The receipt hash chain. prevHash of a receipt is the SHA-256 of the prior
 * receipt body's JCS canonicalisation; the first receipt uses the literal
 * "genesis". Simulated receipts are chain links too (Suite E).
 *
 * M0 scaffold: signature only. Gate: Suite C (M2).
 */

import type { ReceiptBody } from '../types';

export const GENESIS = 'genesis';

export function hashReceiptBody(_body: ReceiptBody): string {
  throw new Error('receipt chain hashing not implemented until M2');
}
