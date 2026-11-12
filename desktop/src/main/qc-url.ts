// Tautan dalam `qc://country-lock` (didaftarkan sebagai protokol OS). Hanya satu bentuk yang sah;
// apa pun selain itu ditolak agar tautan dari luar tak dapat mengarahkan ke rute lain.

export function parseQcUrl(url: string): { route: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'qc:') return null;
  if (parsed.hostname !== 'country-lock') return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  if (parsed.search !== '' || parsed.hash !== '') return null;
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return null;
  return { route: '/country-lock' };
}
