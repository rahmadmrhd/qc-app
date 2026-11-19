/**
 * Pengaturan klien Google langsung (service account; T30a). Dibaca dari `.env` lewat `loadConfig` dan menjadi
 * bagian `Env`. Semua id folder bersifat opsional di tingkat konfigurasi: yang kosong berarti fungsi itu belum
 * dikonfigurasi (folder fungsi lalu dibuat di bawah folder induk dan dicatat di tabel `settings`, `ensureNamedFolder`).
 */
export interface GoogleSettings {
  /** Jalur berkas kunci service account (JSON). Dibaca saat dipakai pertama kali; TIDAK PERNAH dari env mentah. */
  GOOGLE_SA_KEY_FILE: string;
  /** Folder induk Drive milik pemilik (dibagikan ke service account sebagai Editor); folder baru selalu di bawahnya. */
  GOOGLE_ROOT_FOLDER_ID: string;
  /** Spreadsheet data tunggal (ekspor job `exports.sheets` dan sumber impor awal). */
  GOOGLE_SPREADSHEET_ID: string;
  /** Folder lampiran: semua berkas di tabel `files` (gambar item dan lampiran lain); di luar PDF sumber QR dan hasil ekspor QR (setara kunci `settings` DRIVE_FOLDER_ID). */
  ATTACHMENTS_FOLDER_ID: string;
  QR_FOLDER_ID: string;
  QR_DOC_FOLDER_ID: string;
  /** Folder cadangan SQL (dipakai T30). */
  BACKUP_FOLDER_ID: string;
  /** Folder rilis desktop (dibaca server, ditulis CI lewat service account penerbit); bukan anak folder induk. */
  DESKTOP_RELEASES_FOLDER_ID: string;
  /** Folder tambahan yang diizinkan (di luar induk). */
  ALLOWED_FOLDER_IDS: string[];
}

/** Titik suntik untuk tes dan proses: semuanya opsional dan punya bawaan nyata. */
export interface GoogleDeps {
  fetch?: typeof fetch;
  /** Membaca isi berkas kunci (bawaan: `node:fs/promises`). */
  readKeyFile?: (path: string) => Promise<string>;
  now?: () => number;
  /** Jeda antar percobaan ulang (bawaan: `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
}

/** Pola id Drive/spreadsheet/permission yang boleh masuk jalur URL (cegah path traversal dan SSRF). */
export const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}
