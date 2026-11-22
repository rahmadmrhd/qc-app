import { useSyncExternalStore } from 'react';
import { type SidebarRange, sidebarRange } from '@/lib/layout';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/**
 * Rentang viewport untuk sidebar (`phone` < 768, `overlay` 768-959, `wide` >= 960 px), reaktif terhadap perubahan
 * ukuran jendela. Dibaca langsung dari `window.innerWidth` (satu sumber dengan `sidebarRange()` dan varian CSS
 * `sidebar-overlay`); di rentang overlay sidebar tidak memakai mode ikon (`data-collapsible`), tetapi rel yang
 * dipotong (lihat `components/ui/sidebar.tsx`).
 */
export function useSidebarRange(): SidebarRange {
  return useSyncExternalStore(subscribe, sidebarRange, () => 'wide');
}
