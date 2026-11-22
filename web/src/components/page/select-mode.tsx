import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Keadaan mode pilih ponsel yang dibagi antara daftar (`DataCards`, `GridView`, kartu draft) dan bar aksi bawah. */
export interface SelectModeState {
  /** Jumlah butir terpilih (bisa 0 pada mode pilih yang dimulai lewat tombol "Pilih"). */
  count: number;
  /** Semua butir yang boleh dipilih sudah terpilih. */
  allSelected: boolean;
  /** Keluar dari mode pilih (mengosongkan pilihan). */
  exit: () => void;
  /** Pilih semua, atau lepas semuanya bila sudah terpilih semua. */
  toggleAll: () => void;
}

type Register = (state: SelectModeState | null) => void;

const StateContext = createContext<SelectModeState | null>(null);
const RegisterContext = createContext<Register | null>(null);

/**
 * Menampung keadaan mode pilih ponsel. `ListPage` (dan halaman daftar lain seperti Catat Serial Number) memasangnya;
 * daftar di dalamnya mendaftarkan keadaannya lewat `useRegisterSelectMode` dan bar aksi bawah (`BulkBar`, bar
 * pilihan Serial) membacanya lewat `useSelectMode`, sehingga mode pilih hanya punya SATU bar (di bawah): Batalkan
 * pilihan, "N dipilih", Pilih semua, lalu aksi.
 */
export function SelectModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectModeState | null>(null);
  const register = useCallback<Register>((next) => setState(next), []);
  return (
    <RegisterContext.Provider value={register}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </RegisterContext.Provider>
  );
}

/** Keadaan mode pilih yang sedang aktif, atau `null` (tak ada mode pilih / tanpa `SelectModeProvider`). */
export function useSelectMode(): SelectModeState | null {
  return useContext(StateContext);
}

/**
 * Daftar mendaftarkan mode pilihnya selama `selecting`. Mengembalikan `true` bila ada `SelectModeProvider` yang
 * menampung (bar bawah menggantikan header pilihan di atas daftar); `false` = daftar harus menampilkan header
 * pilihannya sendiri (dipakai di luar halaman berkerangka kit).
 */
export function useRegisterSelectMode(
  selecting: boolean,
  info: { count: number; allSelected: boolean; exit: () => void; toggleAll: () => void },
): boolean {
  const register = useContext(RegisterContext);
  const latest = useRef(info);
  latest.current = info;
  const { count, allSelected } = info;
  const api = useMemo(
    () => ({
      exit: () => latest.current.exit(),
      toggleAll: () => latest.current.toggleAll(),
    }),
    [],
  );
  useEffect(() => {
    if (!register || !selecting) return;
    register({ count, allSelected, ...api });
    return () => register(null);
  }, [register, selecting, count, allSelected, api]);
  return register !== null;
}
