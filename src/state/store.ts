/**
 * Decision store. Holds receipts (the chain), decisions (queryable
 * projections), and escalations. The store is what makes readback an interface
 * rather than a log.
 *
 * M1: an in-memory implementation behind the DecisionStore interface. The
 * SQLite-backed store (better-sqlite3) and the readback projections arrive at
 * M2 (Suites C, D) behind this same interface.
 */

import type { ActionProposal, Decision, SignedReceipt } from '../types';
import { GENESIS, hashReceiptBody } from './chain';

/** A held, unexecuted action awaiting escalation resolution. */
export interface HeldEscalation {
  decisionId: string;
  proposal: ActionProposal;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
}

export interface DecisionStore {
  putDecision(decision: Decision): void;
  getDecision(decisionId: string): Decision | undefined;
  listDecisions(filter: { principal?: string; since?: string; decision?: string }): Decision[];

  putReceipt(receipt: SignedReceipt): void;
  getReceipt(receiptRef: string): SignedReceipt | undefined;
  /** The prevHash a new receipt should carry: GENESIS, or the last body hash. */
  lastReceiptHash(): string;

  enqueueEscalation(entry: HeldEscalation): void;
  getEscalation(decisionId: string): HeldEscalation | undefined;
  listEscalations(): HeldEscalation[];
}

export function createStore(): DecisionStore {
  const decisions = new Map<string, Decision>();
  const receipts = new Map<string, SignedReceipt>();
  const order: string[] = []; // receiptRefs in append order
  const escalations = new Map<string, HeldEscalation>();

  return {
    putDecision(decision) {
      decisions.set(decision.decisionId, decision);
    },
    getDecision(decisionId) {
      return decisions.get(decisionId);
    },
    listDecisions(filter) {
      let out = [...decisions.values()];
      if (filter.principal) out = out.filter((d) => d.principal === filter.principal);
      if (filter.decision) out = out.filter((d) => d.decision === filter.decision);
      return out;
    },

    putReceipt(receipt) {
      receipts.set(receipt.receiptId, receipt);
      order.push(receipt.receiptId);
    },
    getReceipt(receiptRef) {
      return receipts.get(receiptRef);
    },
    lastReceiptHash() {
      const lastRef = order[order.length - 1];
      if (lastRef === undefined) return GENESIS;
      const last = receipts.get(lastRef)!;
      return hashReceiptBody(last);
    },

    enqueueEscalation(entry) {
      escalations.set(entry.decisionId, entry);
    },
    getEscalation(decisionId) {
      return escalations.get(decisionId);
    },
    listEscalations() {
      return [...escalations.values()].filter((e) => e.status === 'pending');
    },
  };
}
