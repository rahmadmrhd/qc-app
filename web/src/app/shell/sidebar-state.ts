/**
 * Keadaan sidebar yang diingat di peramban (bukan per akun): hanya terbuka/terlipat. Submenu TIDAK disimpan lagi
 * (spek B11, 2026-11-22): hanya induk yang memuat rute aktif yang terbuka, dan induk lain yang diketuk terbuka
 * sementara sampai rute berubah. Data lama yang memuat `expanded` diabaikan.
 */
export const SIDEBAR_STORAGE_KEY = 'qc.sidebar';

export interface SidebarState {
  open: boolean;
}

const DEFAULT_STATE: SidebarState = { open: true };

export function readSidebarState(): SidebarState {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return { ...DEFAULT_STATE };
    const { open } = data as { open?: unknown };
    return { open: typeof open === 'boolean' ? open : true };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeSidebarState(state: SidebarState): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open: state.open }));
  } catch {
    // Penyimpanan tak tersedia (mode privat, kuota): keadaan hanya berlaku selama tab terbuka.
  }
}
