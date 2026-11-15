import { useMe } from '@/modules/auth/use-me';

/** Teks peringatan akun tanpa penugasan lokasi (dipakai tes dan halaman yang menampilkannya). */
export const NO_LOCATION_MESSAGE =
  'Akun Anda belum ditugaskan ke lokasi mana pun, sehingga data atau filter berdasarkan lokasi dapat kosong. Hubungi admin untuk penugasan lokasi.';

export interface NoLocationNoticeProps {
  /**
   * Halaman ini bergantung pada penugasan lokasi pengguna. Bawaan `true`; halaman yang hanya kadang bergantung
   * (mis. daftar serial: hanya pembaca tanpa `serial: edit`) meneruskan `false` agar peringatan tidak tampil.
   */
  relevant?: boolean;
  className?: string;
}

/**
 * Peringatan bagi pengguna yang tidak punya penugasan lokasi (`me.locations` kosong) pada halaman modul berlokasi:
 * data atau filter lokasi akan tampak kosong, dan itu bukan kerusakan. Tidak tampil bagi super admin.
 */
export function NoLocationNotice({ relevant = true, className }: NoLocationNoticeProps) {
  const me = useMe();
  if (!relevant || me.isSuperAdmin || me.locations.length > 0) return null;
  return (
    <p
      role="status"
      data-testid="no-location-notice"
      className={`rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm ${className ?? ''}`.trim()}
    >
      {NO_LOCATION_MESSAGE}
    </p>
  );
}
