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

export interface CloseWindowDeps {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Menjalankan program dan menunggu selesai; menolak bila gagal. */
  run(file: string, args: string[]): Promise<void>;
}

/**
 * Skrip PowerShell statis: kirim `WM_CLOSE` ke jendela Chrome/Edge yang terlihat dengan judul PERSIS `title`.
 * Judul hanya konstanta ASCII dari kode (tanpa kutip atau garis miring), bukan masukan pengguna.
 */
export function closeWindowScript(title: string): string {
  if (!/^[A-Za-z0-9 -]{1,80}$/.test(title)) throw new Error('Judul jendela tidak valid');
  const member =
    'public delegate bool P(IntPtr h, IntPtr l);' +
    '[DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);' +
    '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);' +
    '[DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);' +
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);' +
    '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);' +
    'public static int Close(string t) { int n = 0; EnumWindows((h, l) => {' +
    ' if (!IsWindowVisible(h)) return true;' +
    ' var s = new StringBuilder(256); var c = new StringBuilder(128);' +
    ' GetWindowText(h, s, 256); GetClassName(h, c, 128);' +
    ' if (c.ToString().StartsWith("Chrome_WidgetWin") && s.ToString() == t) { PostMessage(h, 0x10, IntPtr.Zero, IntPtr.Zero); n++; }' +
    ' return true; }, IntPtr.Zero); return n; }';
  return `Add-Type -Name QcWin -Namespace Qc -UsingNamespace System.Text -MemberDefinition '${member}'; [Qc.QcWin]::Close('${title}') | Out-Null`;
}

/** Menutup popup login (Windows saja); semua kegagalan ditelan: pengguna tinggal menutupnya sendiri. */
export async function closeLoginWindow(title: string, deps: CloseWindowDeps): Promise<void> {
  if (deps.platform !== 'win32') return;
  try {
    const root = deps.env.SystemRoot ?? 'C:\\Windows';
    await deps.run(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      closeWindowScript(title),
    ]);
  } catch {
    // Best-effort.
  }
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
