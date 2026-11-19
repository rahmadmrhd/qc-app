// Kebijakan izin perangkat jendela utama: semua ditolak KECUALI kamera (video) untuk halaman aplikasi sendiri
// (`app://qc`). Kamera dipakai pemindai serial dan foto bukti pada Catat Serial Number; mikrofon, lokasi, notifikasi web,
// dan izin lain tetap ditolak. Murni (tanpa `electron`) agar mudah diuji.

import { APP_ORIGIN } from './app-protocol';

/** Asal pemohon sah: persis origin aplikasi (bukan awalan; `app://qc.evil` atau `app://qc:1` ditolak). */
function isAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    // Skema khusus tanpa `origin` yang bermakna di Node (`app://` = "null"): bandingkan skema dan host (host memuat port).
    const url = new URL(origin);
    return `${url.protocol}//${url.host}` === APP_ORIGIN;
  } catch {
    return false;
  }
}

/** Jawaban untuk `setPermissionRequestHandler` (getUserMedia): hanya video, hanya dari halaman utama `app://qc`. */
export function allowPermissionRequest(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: readonly string[] },
): boolean {
  if (permission !== 'media') return false;
  if (details.isMainFrame !== true) return false;
  if (!isAppOrigin(details.requestingUrl)) return false;
  const types = details.mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === 'video');
}

/**
 * Jawaban untuk `setPermissionCheckHandler` (cek izin, daftar perangkat): `video` atau `unknown` (enumerateDevices
 * memeriksa tanpa jenis); `audio` ditolak.
 */
export function allowPermissionCheck(
  permission: string,
  requestingOrigin: string,
  details: { mediaType?: string },
): boolean {
  if (permission !== 'media') return false;
  if (!isAppOrigin(requestingOrigin)) return false;
  return details.mediaType === 'video' || details.mediaType === 'unknown';
}
