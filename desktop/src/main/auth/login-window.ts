// Membuka halaman login di peramban sistem sebagai jendela kecil bergaya popup (mode aplikasi Chrome/Edge:
// `--app=<url> --window-size=...`, tanpa tab dan address bar). Tetap peramban asli dengan profil bawaan pengguna,
// jadi Google tidak menolaknya sebagai webview tertanam dan akun yang sudah masuk muncul. Hanya bila peramban
// bawaan Windows adalah Chrome atau Edge DAN biner ditemukan; selain itu (Firefox, Brave, tak terbaca, bukan
// Windows, gagal diluncurkan) jatuh ke `openExternal` biasa. Jalur biner hanya dari lokasi pemasangan baku di
// proses utama (tak pernah dari renderer); URL menjadi SATU elemen argv tanpa shell.

export type BrowserKind = 'chrome' | 'edge';

export const POPUP_SIZE = { width: 520, height: 720 } as const;

/** ProgId peramban bawaan untuk `https` (registri `UserChoice`) -> jenis yang mendukung mode aplikasi. */
export function browserKindFromProgId(progId: string | null): BrowserKind | null {
  if (progId === null) return null;
  if (/^ChromeHTML/i.test(progId)) return 'chrome';
  if (/^MSEdgeHTM/i.test(progId)) return 'edge';
  return null;
}

export function candidateExecutables(
  kind: BrowserKind,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const roots = (names: string[]): string[] =>
    names.map((name) => env[name]).filter((value): value is string => !!value);
  if (kind === 'chrome') {
    return [
      ...roots(['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']).map(
        (root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`,
      ),
    ];
  }
  return roots(['ProgramFiles(x86)', 'ProgramFiles']).map(
    (root) => `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
  );
}

/** Argumen mode aplikasi; URL harus http(s) agar tak terbaca sebagai opsi lain. */
export function popupArgs(url: string): string[] {
  if (!/^https?:\/\//i.test(url)) throw new Error('Alamat login harus http(s)');
  return [`--app=${url}`, `--window-size=${POPUP_SIZE.width},${POPUP_SIZE.height}`];
}

export interface LoginWindowDeps {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** ProgId peramban bawaan untuk https; `null` bila tak terbaca. */
  readDefaultProgId(): Promise<string | null>;
  exists(path: string): boolean;
  /** Meluncurkan proses terlepas; menolak bila gagal diluncurkan. */
  launch(exe: string, args: string[]): Promise<void>;
  openExternal(url: string): Promise<void>;
}

/** Membuka `url` sebagai popup bila memungkinkan, selain itu `openExternal` biasa. */
export async function openLoginWindow(url: string, deps: LoginWindowDeps): Promise<void> {
  if (deps.platform === 'win32') {
    try {
      const kind = browserKindFromProgId(await deps.readDefaultProgId());
      const exe = kind
        ? candidateExecutables(kind, deps.env).find((path) => deps.exists(path))
        : null;
      if (exe) {
        await deps.launch(exe, popupArgs(url));
        return;
      }
    } catch {
      // Jatuh ke pembukaan biasa di bawah.
    }
  }
  await deps.openExternal(url);
}
