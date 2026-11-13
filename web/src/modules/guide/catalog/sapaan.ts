import type { GuideEntry } from '../lib/types';

/**
 * Sapaan login (spek 4.4): entri katalog biasa; "sudah ditanyakan" = penanda `sapaan-awal` ada di penyimpanan
 * panduan (`greetingDue` di `lib/offer.ts`). Tanpa langkah: tidak pernah ditawarkan sebagai tur, tidak muncul di
 * kartu atau menu Panduan; hanya dialog sapaan yang memakai penandanya.
 */
export const SAPAAN_AWAL: GuideEntry = {
  id: 'sapaan-awal',
  kind: 'sapaan',
  status: 'disimpan',
  version: 1,
  title: 'Sapaan awal',
  steps: [],
};
