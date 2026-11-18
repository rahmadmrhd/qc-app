import { createHash } from 'node:crypto';

/** Namespace tetap migrasi QC lama: id turunan identik pada setiap putaran (idempoten). */
export const LEGACY_NAMESPACE = '6f1d2a3e-8c4b-5e7a-9b10-2c3d4e5f6a7b';

/** UUID versi 5 (SHA-1) dari `name` dalam `namespace`; bentuknya UUID baku huruf kecil. */
export function uuidV5(name: string, namespace: string = LEGACY_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
