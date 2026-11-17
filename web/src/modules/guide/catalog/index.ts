import type { GuideEntry } from '../lib/types';
import { DEVICE_GUIDES } from './device';
import { HANDOVER_GUIDES } from './handover';
import { HANDOVER_TIPS } from './handover-tips';
import { DASAR_LAYOUT } from './layout';
import { QRCODE_GUIDES } from './qrcode';
import { SAPAAN_AWAL } from './sapaan';
import { SERIAL_GUIDES } from './serial';

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
  ...HANDOVER_TIPS,
  ...QRCODE_GUIDES,
  ...SERIAL_GUIDES,
];
