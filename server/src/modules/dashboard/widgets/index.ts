import type { WidgetImpl } from '../registry';
import { HANDOVER_WIDGETS } from './handover';
import { POSTEL_WIDGETS } from './postel';
import { REPORT_WIDGETS } from './report';
import { SERIAL_WIDGETS } from './serial';
import { STICKER_WIDGETS } from './sticker';

/** Semua implementasi widget; tiap grup menambahkan daftarnya di sini (`registry.ts` mendaftarkannya sekaligus). */
export const ALL_WIDGETS: readonly WidgetImpl[] = [
  ...HANDOVER_WIDGETS,
  ...SERIAL_WIDGETS,
  ...REPORT_WIDGETS,
  ...STICKER_WIDGETS,
  ...POSTEL_WIDGETS,
];
