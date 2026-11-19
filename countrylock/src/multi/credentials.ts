// Urutan kredensial per perangkat (legacy L4.4, L4.6): indeks 0 = default `config.QC` (sandi ada di port main, bukan
// di data perangkat), indeks i = antrean bersama [i-1]. Murni.

import type { Credential } from './types';

export function credentialAt(
  index: number,
  base: Credential,
  queue: readonly Credential[],
): Credential | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (index === 0) return base;
  return queue[index - 1] ?? null;
}

export function credentialSource(index: number): string {
  return index <= 0 ? 'Default' : `Antrian #${index}`;
}

/** Indeks kredensial berikutnya, atau `null` bila antrean sudah habis. */
export function nextCredentialIndex(index: number, queueLength: number): number | null {
  const next = index + 1;
  return next <= queueLength ? next : null;
}

/**
 * Menambah kredensial manual ke ujung antrean. Username dan sandi wajib terisi, dan pasangan yang sama dengan entri antrean
 * ditolak; pada penolakan antrean yang SAMA dikembalikan (pemanggil bisa membandingkan dengan `===`).
 */
export function addCredential(queue: readonly Credential[], cred: Credential): Credential[] {
  if (cred.username.trim() === '' || cred.password === '') return queue as Credential[];
  if (queue.some((c) => c.username === cred.username && c.password === cred.password)) {
    return queue as Credential[];
  }
  return [...queue, { username: cred.username, password: cred.password }];
}
