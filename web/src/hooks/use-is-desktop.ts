import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';

/** Lebar >= 768 px = tampilan lebar (kanban, tabel); lebih sempit = daftar kartu. Tanpa `matchMedia` (mis. jsdom) dianggap lebar. */
export function useIsDesktop(): boolean {
  const read = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true;
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}
