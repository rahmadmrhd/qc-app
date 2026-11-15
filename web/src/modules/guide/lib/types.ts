import type { Level, ModuleKey } from '@shared/permissions';
import type { TourMenuId } from './tour-menu';

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
  /**
   * `next` = tombol Lanjut; `click` = menunggu pengguna mengklik sendiri targetnya; `wait` = pengguna mengerjakan
   * sesuatu sendiri di target (mis. memilih item) dan tombol Lanjut baru aktif setelah elemen `waitFor` muncul
   * (target tidak ditutup penahan dan tidak digelapkan, supaya dapat dioperasikan). Tur tetap tidak mengisi apa pun.
   */
  advance: 'next' | 'click' | 'wait';
  /**
   * Hanya untuk `advance: 'wait'`: nilai `data-tour` elemen yang MUNCUL begitu pengguna selesai mengerjakan target
   * (mis. bagian form yang baru ditampilkan setelah item dipilih). Wajib ada di sumber (dijaga tes katalog).
   */
  waitFor?: string;
  /** Langkah hanya muncul bagi yang berhak (dihitung per pengguna). */
  izin?: GuideAccess;
  tip?: string;
  /**
   * Target berada di sidebar: di layar sempit (sidebar tertutup) mesin tur membukanya lebih dulu. Tanpa ini
   * sidebar ponsel tidak pernah dibuka, mis. untuk target yang memang tak ada (papan kosong, satu lokasi).
   */
  inSidebar?: boolean;
  /**
   * Menu (id = `data-tour` pemicunya) yang dibuka mesin tur SENDIRI selama langkah ini aktif, supaya `target` di
   * dalam menu dapat disorot. Murni UI: tak mengklik apa pun, tak mengubah data; menu ditutup saat langkah
   * berganti, tur berakhir, atau tur dibatalkan (kecuali yang memang sudah dibuka pengguna). Pemicu yang tak ada
   * di layar (mis. pemilih lokasi untuk satu lokasi) = langkah dilewati.
   */
  buka?: TourMenuId;
  /**
   * Langkah yang targetnya bergantung data (mis. kartu task di papan): bila `target` tak muncul dalam batas
   * waktu, langkah TIDAK dilewati melainkan tampil sebagai kartu di tengah layar tanpa sorotan, dengan teks ini
   * (menjelaskan keadaannya) dan demo `tip` bila ada. Tetap terhitung pada "Langkah x dari N". Langkah yang
   * `izin`-nya gugur tetap dibuang di awal.
   */
  teksJikaKosong?: string;
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
