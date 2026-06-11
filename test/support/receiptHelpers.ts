/**
 * Receipt-test helpers (Suite C). hash() mirrors the gateway's prevHash
 * computation so the chain assertion checks the gateway against an independent
 * recomputation; jcs() exposes the RFC 8785 canonicaliser for the key-ordering
 * stability test; sampleA/reorderKeys give that test its before/after pair.
 */

import canonicalize from 'canonicalize';
import { hashReceiptBody } from '../../src/state/chain';
import type { SignedReceipt } from '../../src/types';

/** The SHA-256 of a receipt's JCS canonical body - the value its successor's
 * prevHash must equal. */
export function hash(receipt: SignedReceipt): string {
  return hashReceiptBody(receipt);
}

/** RFC 8785 (JCS) canonicalisation as a string. */
export function jcs(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error('value is not canonicalisable');
  return canonical;
}

/** A nested sample object with deliberately unsorted keys. */
export const sampleA = {
  z: 1,
  a: { y: true, b: [3, 2, 1] },
  m: 'value',
  d: { n: null, c: 2 },
};

/** Deep-clone reversing object key order (arrays kept in place). JCS sorts keys
 * on output, so jcs(x) === jcs(reorderKeys(x)). */
export function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => reorderKeys(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      out[key] = reorderKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}
