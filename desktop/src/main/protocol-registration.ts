// Pendaftaran skema `qc://` untuk mode pengembangan (`electron .`, tanpa installer). Aplikasi terkemas
// mendaftarkannya sendiri (`setAsDefaultProtocolClient('qc')`); saat pengembangan registri TIDAK ditulis kecuali
// diminta eksplisit lewat env `QC_DEV_REGISTER_PROTOCOL=1`, karena tanpa pendaftaran peramban tak punya tujuan
// untuk `302 -> qc://auth?...` dan login Google desktop menggantung di peramban.

import { resolve } from 'node:path';

export interface DevProtocolRegistration {
  /** Program yang dipanggil Windows untuk `qc://...` (biner Electron). */
  execPath: string;
  /** Argumen sebelum URL: folder aplikasi + folder data yang SAMA, agar instans baru menyambung ke instans yang berjalan. */
  args: string[];
}

/**
 * Argumen pendaftaran untuk mode pengembangan, atau `null` bila tidak diminta/tak dapat ditentukan. Folder data ikut
 * disertakan karena kunci instans tunggal Electron per folder data: tanpa itu `qc://auth` membuka instans kedua
 * berprofil lain (tanpa verifier PKCE) alih-alih menyerahkan kode ke jendela yang menunggu.
 */
export function devProtocolRegistration(
  env: Readonly<Record<string, string | undefined>>,
  execPath: string,
  entry: string | undefined,
  userData: string,
): DevProtocolRegistration | null {
  if (env.QC_DEV_REGISTER_PROTOCOL !== '1' || !entry) return null;
  return { execPath, args: [resolve(entry), `--user-data-dir=${userData}`] };
}
