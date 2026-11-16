/**
 * Perangkat sentuh (ponsel, juga tablet layar sentuh)? Pointer utama kasar (`pointer: coarse`) = jari; desktop dengan
 * mouse tidak. Aman tanpa `matchMedia` (jsdom, SSR, peramban lama): dianggap bukan mobile. Dievaluasi saat dipanggil
 * (saat render), bukan disimpan, supaya mengikuti perubahan mode perangkat.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
