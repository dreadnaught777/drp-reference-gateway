/**
 * Receipts: JCS-canonicalised (RFC 8785), SHA-256 hashed, Ed25519 detached
 * signature carried alongside the body, chained by prevHash. The first receipt
 * uses the literal "genesis". Receipts verify offline against the key the
 * gateway publishes at GET /v1/keys.
 *
 * The signature is over the SHA-256 digest of the canonical body, so the signed
 * payload is fixed-size; the same digest the offline verifier recomputes.
 */

import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import canonicalize from 'canonicalize';
import type { ReceiptBody, SignedReceipt } from '../types';

export interface PublishedKey {
  keyId: string;
  alg: 'Ed25519';
  publicKey: string; // PEM (SPKI)
  retired?: boolean;
}

/**
 * Holds the gateway's Ed25519 key and signs receipt bodies. A single static
 * key is acceptable for v0.1 (test plan: rotation is deferred to v0.2).
 */
export class ReceiptSigner {
  readonly keyId: string;
  readonly #privateKey: KeyObject;
  readonly #publicKeyPem: string;

  constructor(keyId = 'k1') {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    this.keyId = keyId;
    this.#privateKey = privateKey;
    this.#publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  get publicKeyPem(): string {
    return this.#publicKeyPem;
  }

  get publicKey(): KeyObject {
    return createPublicKey(this.#publicKeyPem);
  }

  published(): PublishedKey {
    return { keyId: this.keyId, alg: 'Ed25519', publicKey: this.#publicKeyPem };
  }

  /** Sign an arbitrary message with the same Ed25519 key (context tokens). */
  signDetached(message: Buffer): Buffer {
    return cryptoSign(null, message, this.#privateKey);
  }

  /** Verify a detached signature over a message against the public key. */
  verifyDetached(message: Buffer, sig: Buffer): boolean {
    try {
      return cryptoVerify(null, message, this.publicKey, sig);
    } catch {
      return false;
    }
  }

  /** Sign a receipt body, returning the body with detached { sig, keyId }. */
  sign(body: ReceiptBody): SignedReceipt {
    const canonical = canonicalize(body);
    if (canonical === undefined) {
      throw new Error('receipts: body is not canonicalisable');
    }
    const digest = createHash('sha256').update(canonical, 'utf8').digest();
    const sig = cryptoSign(null, digest, this.#privateKey).toString('base64');
    return { ...body, sig, keyId: this.keyId };
  }
}
