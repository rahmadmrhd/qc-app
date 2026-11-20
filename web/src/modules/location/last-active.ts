/** Penanda waktu terakhir aplikasi aktif, PER AKUN (akun kedua di perangkat bersama tak mewarisi penanda akun lain). */
export const lastActiveKey = (email: string) => `qc.lastActive:${email}`;

export function clearLastActive(email: string | null | undefined): void {
  if (!email) return;
  try {
    localStorage.removeItem(lastActiveKey(email));
  } catch {
    // Penyimpanan diblokir: tak ada yang perlu dibuang.
  }
}
