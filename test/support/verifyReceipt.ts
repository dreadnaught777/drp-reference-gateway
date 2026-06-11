/**
 * Offline receipt verification helper (test plan section 0). Ed25519 over the
 * SHA-256 of the JCS (RFC 8785) canonicalisation, so receipt tests do not
 * depend on the gateway to check the gateway.
 *
 * The signature is carried alongside the body as { sig, keyId } and is NOT
 * part of the signed content: it is stripped before canonicalising. Mutating
 * any signed field breaks verification (Suite C tamper test).
 */

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { SignedReceipt } from '../../src/types';

export type PublicKeyInput = string | KeyObject;

function toKeyObject(pubkey: PublicKeyInput): KeyObject {
  if (typeof pubkey === 'string') {
    // Accept PEM (SPKI) directly; the gateway publishes PEM at /v1/keys.
    return createPublicKey(pubkey);
  }
  return pubkey;
}

/**
 * Verify a stored receipt against a published Ed25519 public key. Returns true
 * only if the detached signature matches the canonicalised, hashed body.
 */
export function verifyReceipt(receipt: SignedReceipt, pubkey: PublicKeyInput): boolean {
  const { sig, keyId, ...body } = receipt as SignedReceipt & Record<string, unknown>;
  void keyId;
  if (typeof sig !== 'string' || sig.length === 0) return false;

  const canonical = canonicalize(body);
  if (canonical === undefined) return false;

  // Ed25519 in node:crypto signs the message directly; we sign the SHA-256 of
  // the canonical bytes so the signed payload is fixed-size and chain-friendly.
  const digest = createHash('sha256').update(canonical, 'utf8').digest();

  try {
    return cryptoVerify(null, digest, toKeyObject(pubkey), Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}
