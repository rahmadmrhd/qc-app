import { api } from '@/lib/api';

/**
 * Serah-terima peramban -> aplikasi desktop (keputusan pemilik 2026-11-16): server menerbitkan tiket sekali pakai
 * (60 detik) untuk akun yang login di web, dibawa tautan `qc://country-lock?handoff=<tiket>&as=<email>`. `as` hanya
 * petunjuk tampilan untuk aplikasi desktop (yang menentukan akun adalah penukaran tiket di server).
 */
export function handoffUrl(ticket: string, email: string): string {
  return `qc://country-lock?handoff=${encodeURIComponent(ticket)}&as=${encodeURIComponent(email)}`;
}

/**
 * Meminta tiket lalu membuka aplikasi desktop. Harus dipanggil dari gestur pengguna (klik): peramban menahan
 * peluncuran protokol eksternal tanpa aktivasi pengguna yang baru. Galat (tanpa izin, tanpa sesi, server mati)
 * dilempar ke pemanggil.
 */
export async function openInDesktop(): Promise<void> {
  const { ticket, email } = await api('desktop.handoff', {});
  window.location.href = handoffUrl(ticket, email);
}
