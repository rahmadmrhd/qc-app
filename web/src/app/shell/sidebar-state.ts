/** Keadaan sidebar yang diingat di peramban (bukan per akun): terbuka/terlipat dan submenu yang dibuka pengguna. */
export const SIDEBAR_STORAGE_KEY = 'qc.sidebar';

export interface SidebarState {
  open: boolean;
  expanded: string[];
}

const DEFAULT_STATE: SidebarState = { open: true, expanded: [] };

export function readSidebarState(): SidebarState {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE, expanded: [] };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return { ...DEFAULT_STATE, expanded: [] };
    const { open, expanded } = data as { open?: unknown; expanded?: unknown };
    return {
      open: typeof open === 'boolean' ? open : true,
      expanded: Array.isArray(expanded)
        ? expanded.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return { ...DEFAULT_STATE, expanded: [] };
  }
}

export function writeSidebarState(state: SidebarState): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Penyimpanan tak tersedia (mode privat, kuota): keadaan hanya berlaku selama tab terbuka.
  }
}
