/**
 * Decision store (SQLite). Holds receipts (the chain), decisions (queryable
 * projections), escalations, conflicts, and policy bundle versions. The store
 * is what makes readback an interface rather than a log.
 *
 * M0 scaffold: signature only. Gate: Suites C, D (M2).
 */

import type { SignedReceipt } from '../types';

export interface DecisionStore {
  putReceipt(receipt: SignedReceipt): void;
  getReceipt(receiptRef: string): SignedReceipt | undefined;
  lastReceiptHash(): string;
}

export function createStore(): DecisionStore {
  throw new Error('decision store not implemented until M2');
}
