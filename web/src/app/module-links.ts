import type { ModuleKey } from '@shared/permissions';
import type { LinkProps } from '@tanstack/react-router';

/** Modul yang sudah punya halaman. Modul tanpa entri ditandai "Segera hadir" di beranda. */
export const MODULE_LINKS: Partial<Record<ModuleKey, LinkProps['to']>> = {};
