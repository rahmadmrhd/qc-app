import { describe, expect, test } from 'vitest';
import {
  browserKindFromProgId,
  candidateExecutables,
  type LoginWindowDeps,
  openLoginWindow,
  popupArgs,
} from './login-window';

const ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
};
const URL_LOGIN = 'https://qc.example.com/auth/desktop/start?challenge=c&state=s&port=49321';

describe('browserKindFromProgId', () => {
  test('mengenali Chrome dan Edge; selain itu (Firefox, Brave, kosong) bukan', () => {
    expect(browserKindFromProgId('ChromeHTML')).toBe('chrome');
    expect(browserKindFromProgId('MSEdgeHTM')).toBe('edge');
    expect(browserKindFromProgId('FirefoxURL-308046B0AF4A39CB')).toBeNull();
    expect(browserKindFromProgId('BraveHTML')).toBeNull();
    expect(browserKindFromProgId(null)).toBeNull();
  });
});

describe('popupArgs', () => {
  test('URL menjadi satu argumen --app dan ukuran jendela; selain http(s) ditolak', () => {
    expect(popupArgs(URL_LOGIN)).toEqual([`--app=${URL_LOGIN}`, '--window-size=520,720']);
    for (const bad of ['--user-data-dir=C:\\x', 'file:///c:/x', 'javascript:alert(1)', '']) {
      expect(() => popupArgs(bad), bad).toThrow();
    }
  });
});

describe('candidateExecutables', () => {
  test('lokasi pemasangan baku; variabel yang tidak ada dilewati', () => {
    expect(candidateExecutables('edge', ENV)).toEqual([
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]);
    expect(candidateExecutables('chrome', { LOCALAPPDATA: 'D:\\L' })).toEqual([
      'D:\\L\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });
});

function setup(options: {
  platform?: NodeJS.Platform;
  progId?: string | null;
  present?: string[];
  launchFails?: boolean;
  progIdThrows?: boolean;
}) {
  const launched: { exe: string; args: string[] }[] = [];
  const opened: string[] = [];
  const deps: LoginWindowDeps = {
    platform: options.platform ?? 'win32',
    env: ENV,
    readDefaultProgId: async () => {
      if (options.progIdThrows) throw new Error('reg gagal');
      return options.progId ?? null;
    },
    exists: (path) => (options.present ?? []).includes(path),
    launch: async (exe, args) => {
      if (options.launchFails) throw new Error('spawn gagal');
      launched.push({ exe, args });
    },
    openExternal: async (url) => {
      opened.push(url);
    },
  };
  return { deps, launched, opened };
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe('openLoginWindow', () => {
  test('bawaan Edge dan biner ada: popup mode aplikasi, bukan openExternal', async () => {
    const { deps, launched, opened } = setup({ progId: 'MSEdgeHTM', present: [EDGE] });
    await openLoginWindow(URL_LOGIN, deps);
    expect(launched).toEqual([
      { exe: EDGE, args: [`--app=${URL_LOGIN}`, '--window-size=520,720'] },
    ]);
    expect(opened).toEqual([]);
  });

  test('bawaan Chrome: memakai Chrome (bukan Edge) walau Edge juga terpasang', async () => {
    const { deps, launched } = setup({ progId: 'ChromeHTML', present: [EDGE, CHROME] });
    await openLoginWindow(URL_LOGIN, deps);
    expect(launched.map((l) => l.exe)).toEqual([CHROME]);
  });

  test('bawaan Firefox/Brave, tak terbaca, atau registri gagal: openExternal biasa', async () => {
    for (const options of [
      { progId: 'FirefoxURL-308046B0AF4A39CB', present: [EDGE, CHROME] },
      { progId: 'BraveHTML', present: [EDGE] },
      { progId: null, present: [EDGE] },
      { progIdThrows: true, present: [EDGE] },
    ]) {
      const { deps, launched, opened } = setup(options);
      await openLoginWindow(URL_LOGIN, deps);
      expect(launched, JSON.stringify(options)).toEqual([]);
      expect(opened, JSON.stringify(options)).toEqual([URL_LOGIN]);
    }
  });

  test('biner tidak ditemukan atau gagal diluncurkan: jatuh ke openExternal', async () => {
    const missing = setup({ progId: 'ChromeHTML', present: [] });
    await openLoginWindow(URL_LOGIN, missing.deps);
    expect(missing.opened).toEqual([URL_LOGIN]);
    const failing = setup({ progId: 'MSEdgeHTM', present: [EDGE], launchFails: true });
    await openLoginWindow(URL_LOGIN, failing.deps);
    expect(failing.opened).toEqual([URL_LOGIN]);
  });

  test('bukan Windows: langsung openExternal', async () => {
    const { deps, launched, opened } = setup({
      platform: 'darwin',
      progId: 'MSEdgeHTM',
      present: [EDGE],
    });
    await openLoginWindow(URL_LOGIN, deps);
    expect(launched).toEqual([]);
    expect(opened).toEqual([URL_LOGIN]);
  });
});
