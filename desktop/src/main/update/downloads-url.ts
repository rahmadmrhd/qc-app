import { normalizeServerUrl } from '../settings';

/**
 * Alamat halaman daftar unduhan (`<server>/desktop`) dari alamat server di pengaturan; `null` bila alamatnya tak sah.
 * Dipakai jembatan `app.openDownloads`: alamat selalu dari pengaturan, tak pernah dari renderer.
 */
export function downloadsPageUrl(serverUrl: unknown): string | null {
  const origin = normalizeServerUrl(serverUrl);
  return origin === null ? null : `${origin}/desktop`;
}
