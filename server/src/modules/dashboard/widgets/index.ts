import type { WidgetImpl } from '../registry';
import { HANDOVER_WIDGETS } from './handover';

/** Semua implementasi widget; tiap grup menambahkan daftarnya di sini (`registry.ts` mendaftarkannya sekaligus). */
export const ALL_WIDGETS: readonly WidgetImpl[] = [...HANDOVER_WIDGETS];
