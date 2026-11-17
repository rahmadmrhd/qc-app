// Panduan interaktif (spek 2026-11-13-panduan-interaktif-design.md): daftar id, versi, dan cakupan panduan.
// Murni; dipakai server (validasi `guides.mark`/`guides.reset`) dan web (mesin panduan, daftar di menu profil).

/** Id panduan yang dikenal. Menambah panduan = menambah id di sini dan isinya di web. */
export const GUIDE_IDS = [
  'sapaan-awal',
  'dasar-layout',
  'handover-dasar',
  'tip-handover-tempel-wa',
  'tip-handover-checklist',
  'tip-handover-komentar',
  'qrcode-dasar',
  'serial-daftar',
  'serial-detail',
  'serial-catat',
  'serial-massal',
  'serial-laporan-daftar',
  'serial-laporan',
] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

/**
 * Versi tiap panduan. Menaikkan versi membuat panduan itu muncul lagi bagi pengguna yang sudah menyelesaikan versi
 * lama (progres tersimpan = `version` terakhir yang diselesaikan).
 */
export const GUIDE_VERSIONS: Record<GuideId, number> = {
  'sapaan-awal': 1,
  'dasar-layout': 1,
  'handover-dasar': 1,
  'tip-handover-tempel-wa': 1,
  'tip-handover-checklist': 1,
  'tip-handover-komentar': 1,
  'qrcode-dasar': 1,
  'serial-daftar': 1,
  'serial-detail': 1,
  'serial-catat': 1,
  'serial-massal': 1,
  'serial-laporan-daftar': 1,
  'serial-laporan': 1,
};

/**
 * Panduan yang "mencakup" panduan lain: menyelesaikan kunci berarti panduan di daftarnya dianggap selesai juga.
 * Kosong pada tahap awal.
 */
export const GUIDE_COVERS: Partial<Record<GuideId, readonly GuideId[]>> = {};

/** Progres satu panduan milik pemanggil: versi terakhir yang diselesaikan. */
export interface GuideProgressDto {
  id: GuideId;
  version: number;
}
