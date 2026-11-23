import type { WidgetImpl } from '../registry';
import { HANDOVER_WIDGETS } from './handover';
import { SERIAL_WIDGETS } from './serial';

/** Semua implementasi widget; tiap grup menambahkan daftarnya di sini (`registry.ts` mendaftarkannya sekaligus). */
export const ALL_WIDGETS: readonly WidgetImpl[] = [...HANDOVER_WIDGETS, ...SERIAL_WIDGETS];
