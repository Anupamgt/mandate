import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@mandate/shared";
import type { MandateBody } from "./schema.js";

const hashes = ed as unknown as { hashes?: { sha512?: typeof sha512 } };
if (hashes.hashes && !hashes.hashes.sha512) {
  hashes.hashes.sha512 = sha512;
}

export type OperatorKeyPair = {
  privateKeyHex: string;
  publicKeyHex: string;
};

export async function generateOperatorKeyPair(): Promise<OperatorKeyPair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKeyHex: bytesToHex(privateKey), publicKeyHex: bytesToHex(publicKey) };
}

export async function signMandateBody(
  body: MandateBody,
  privateKeyHex: string,
): Promise<string> {
  const msg = utf8ToBytes(canonicalJson(body));
  const sig = await ed.signAsync(msg, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function verifyMandateBody(
  body: MandateBody,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const msg = utf8ToBytes(canonicalJson(body));
    return await ed.verifyAsync(hexToBytes(signatureHex), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export async function signRevocation(
  payload: { mandate_id: string; reason: string; revoked_at: string },
  privateKeyHex: string,
): Promise<string> {
  const msg = utf8ToBytes(canonicalJson(payload));
  const sig = await ed.signAsync(msg, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function verifyRevocation(
  payload: { mandate_id: string; reason: string; revoked_at: string },
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const msg = utf8ToBytes(canonicalJson(payload));
    return await ed.verifyAsync(hexToBytes(signatureHex), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export async function signApproval(
  payload: { spend_request_id: string; approved_at: string },
  privateKeyHex: string,
): Promise<string> {
  const msg = utf8ToBytes(canonicalJson(payload));
  const sig = await ed.signAsync(msg, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function verifyApproval(
  payload: { spend_request_id: string; approved_at: string },
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const msg = utf8ToBytes(canonicalJson(payload));
    return await ed.verifyAsync(hexToBytes(signatureHex), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
