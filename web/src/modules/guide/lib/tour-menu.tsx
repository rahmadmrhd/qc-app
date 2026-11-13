import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Id menu yang boleh dibuka tur (`GuideStep.buka`). Sama dengan nilai `data-tour` pada tombol pemicunya, sehingga
 * mesin tur dapat memeriksa ada-tidaknya pemicu di DOM (pemilih lokasi hanya dirender bila lokasi > 1).
 */
export const TOUR_MENU_IDS = [
  'location-picker',
  'notification-bell',
  'theme-toggle',
  'user-menu',
] as const;
export type TourMenuId = (typeof TOUR_MENU_IDS)[number];

interface TourMenuValue {
  /** Menu yang SEDANG diminta terbuka oleh langkah tur aktif; `null` = tur tidak meminta apa pun. */
  openId: TourMenuId | null;
  setOpenId: (id: TourMenuId | null) => void;
}

const TourMenuContext = createContext<TourMenuValue>({ openId: null, setOpenId: () => undefined });

/** Menyimpan menu yang diminta terbuka oleh tur. Dipasang `TourProvider` di atas semua anaknya. */
export function TourMenuProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenIdState] = useState<TourMenuId | null>(null);
  const setOpenId = useCallback((id: TourMenuId | null) => setOpenIdState(id), []);
  const value = useMemo(() => ({ openId, setOpenId }), [openId, setOpenId]);
  return <TourMenuContext.Provider value={value}>{children}</TourMenuContext.Provider>;
}

/** Dipakai mesin tur untuk meminta/melepas pembukaan sebuah menu. */
export function useSetTourMenu(): (id: TourMenuId | null) => void {
  return useContext(TourMenuContext).setOpenId;
}

/** Peristiwa "interaksi di luar" Radix yang boleh dibatalkan (`preventDefault`). */
type OutsideEvent = { preventDefault: () => void };

/**
 * Menghubungkan sebuah menu (DropdownMenu/Popover Radix) ke tur. Pembukaan oleh tur bersifat murni UI: tur hanya
 * MENYALAKAN `open` (di-OR dengan pilihan pengguna sendiri), tanpa klik sintetis dan tanpa menyentuh data.
 *
 * - Terpaksa terbuka (`forced`): menu dibuat non-modal (tak menaruh `pointer-events: none` pada body, tak menjebak
 *   fokus, tak menyembunyikan kartu tur dari pembaca layar) dan interaksi/fokus di luar (kartu tur, sorotan) tidak
 *   menutupnya. Esc tetap menutup tur, dan keluarnya tur melepas `forced` sehingga menu menutup.
 * - Menu yang sudah dibuka pengguna sendiri tetap terbuka sesudah tur (`userOpen` tak disentuh), tidak ditutup lalu
 *   dibuka ulang.
 *
 * Tanpa `TourMenuProvider` (atau tanpa tur) `forced` selalu false dan perilaku menu sama seperti sebelumnya.
 */
export function useTourMenu(id: TourMenuId) {
  const { openId } = useContext(TourMenuContext);
  const forced = openId === id;
  const [userOpen, setUserOpen] = useState(false);
  return {
    forced,
    /** Sebar ke `<DropdownMenu>`/`<Popover>`. */
    rootProps: {
      open: userOpen || forced,
      onOpenChange: setUserOpen,
      ...(forced ? { modal: false } : {}),
    },
    /** Sebar ke `<DropdownMenuContent>`/`<PopoverContent>`. */
    contentProps: forced
      ? { onInteractOutside: (event: OutsideEvent) => event.preventDefault() }
      : {},
    /** Menutup menu dari dalam (mis. setelah memilih butir); tidak menutup yang dipaksa tur. */
    setOpen: setUserOpen,
  };
}
