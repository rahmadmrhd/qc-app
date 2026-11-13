import type { GuideEntry } from '../lib/types';
import { DEVICE_GUIDES } from './device';
import { HANDOVER_GUIDES } from './handover';
import { DASAR_LAYOUT } from './layout';
import { SAPAAN_AWAL } from './sapaan';

/**
 * Katalog panduan (spek 4.1). Isinya ditambah per modul (tur `dasar`, `baru`, tooltip `tip`, sapaan).
 * `catalog.test.ts` menjaganya sejalan dengan `shared/guides.ts`, rute, `data-tour` di sumber, dan klip;
 * `module-coverage.test.ts` menjaga tiap modul berhalaman punya panduan `dasar` (atau tercatat belum).
 */
export const GUIDE_CATALOG: readonly GuideEntry[] = [
  SAPAAN_AWAL,
  DASAR_LAYOUT,
  ...DEVICE_GUIDES,
  ...HANDOVER_GUIDES,
];
