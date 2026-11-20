import { createFileRoute, redirect } from '@tanstack/react-router';

// Halaman Stok Stiker digabung ke halaman Stiker (keputusan pemilik 2026-11-20). Rute lama dipertahankan sebagai
// pengalihan agar markah, tautan di email ringkasan harian, dan riwayat peramban tetap sampai.
export const Route = createFileRoute('/_app/sticker/stock')({
  beforeLoad: () => {
    throw redirect({ to: '/sticker', replace: true });
  },
});
