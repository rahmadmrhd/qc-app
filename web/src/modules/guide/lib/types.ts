import type { Level, ModuleKey } from '@shared/permissions';

/** Satu syarat izin; bentuknya sama dengan `NavPermission` (`app/navigation.ts`). */
export interface GuidePermission {
  module: ModuleKey;
  level: Level;
  /** `scope: 'location'` = cukup bila izin ada di minimal satu lokasi aktif terpilih. */
  scope?: 'location';
}

/** Satu izin, atau daftar (salah satu cukup; sama dengan `NavItem.permission`). */
export type GuideAccess = GuidePermission | readonly GuidePermission[];

export interface GuideStep {
  /** Nilai atribut `data-tour="..."` pada elemen yang disorot. */
  target: string;
  text: string;
  /** Rute tujuan; kosong = tetap di halaman sekarang. */
  route?: string;
  /** `next` = tombol Lanjut; `click` = menunggu pengguna mengklik sendiri targetnya. */
  advance: 'next' | 'click';
  /** Langkah hanya muncul bagi yang berhak (dihitung per pengguna). */
  izin?: GuideAccess;
  tip?: string;
  /**
   * Target berada di sidebar: di layar sempit (sidebar tertutup) mesin tur membukanya lebih dulu. Tanpa ini
   * sidebar ponsel tidak pernah dibuka, mis. untuk target yang memang tak ada (papan kosong, satu lokasi).
   */
  inSidebar?: boolean;
}

export interface GuideEntry {
  /** Unik; untuk `status: 'disimpan'` harus ada di `GUIDE_IDS` (`shared/guides.ts`). */
  id: string;
  kind: 'dasar' | 'baru' | 'tip' | 'sapaan';
  /** `disimpan` = penanda selesai di penyimpanan akun/perangkat; `diturunkan` = dihitung dari keadaan perangkat. */
  status: 'disimpan' | 'diturunkan';
  version: number;
  title: string;
  /** Kosong = semua pengguna. */
  izin?: GuideAccess;
  /** Awalan rute tempat banner panduan ini boleh muncul; kosong = tanpa banner. */
  halaman?: string;
  steps: readonly GuideStep[];
  /**
   * Hanya untuk `kind: 'baru'`: id panduan `dasar` induknya. Panduan `baru` baru ditawarkan setelah `dasar` itu
   * selesai (spek 4.2); tes katalog mewajibkan field ini dan keberadaan entrinya.
   */
  dasar?: string;
  /** Id panduan `baru` yang sudah tercakup bila panduan `dasar` ini selesai (= `GUIDE_COVERS`). */
  covers?: readonly string[];
}
