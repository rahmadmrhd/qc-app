import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChangelogError,
  type CliDeps,
  compareSemver,
  compileRelease,
  extractSection,
  FRAGMENT_MAX_CHARS,
  FRAGMENT_NAME_PATTERN,
  type FragmentKind,
  isSemver,
  parseFragment,
  realDeps,
  runCli,
} from './changelog';

/** Satu fragmen berisi satu butir; `area` kosong = tanpa area. */
const frag = (name: string, kind: FragmentKind, text: string, area: string | null = null) => ({
  name,
  entries: [{ kind, area, text }],
});

describe('parseFragment', () => {
  test('satu baris "tipe(area): teks" menjadi satu butir; area boleh dihilangkan', () => {
    expect(
      parseFragment('20261117-tombol-baru.md', 'feat(beranda): tombol baru di beranda\n'),
    ).toEqual({
      name: '20261117-tombol-baru.md',
      entries: [{ kind: 'ditambah', area: 'beranda', text: 'tombol baru di beranda' }],
    });
    expect(parseFragment('20261117-a.md', 'fix: perbaikan tanpa area').entries).toEqual([
      { kind: 'diperbaiki', area: null, text: 'perbaikan tanpa area' },
    ]);
  });

  test('tipe dipetakan ke jenis: feat=ditambah, change/refactor/perf=diubah, fix=diperbaiki, sisanya internal', () => {
    const kindOf = (type: string) =>
      parseFragment('20261117-a.md', `${type}: isi`).entries[0]?.kind;
    expect(kindOf('feat')).toBe('ditambah');
    for (const type of ['change', 'refactor', 'perf']) expect(kindOf(type), type).toBe('diubah');
    expect(kindOf('fix')).toBe('diperbaiki');
    for (const type of ['chore', 'ci', 'docs', 'test', 'build', 'style']) {
      expect(kindOf(type), type).toBe('internal');
    }
  });

  test('satu berkas boleh memuat beberapa butir (satu per baris); baris kosong diabaikan', () => {
    const parsed = parseFragment(
      '20261117-a.md',
      'feat(serial): satu\n\nfix(desktop): dua\nchore(ci): tiga\n',
    );
    expect(parsed.entries.map((e) => [e.kind, e.area, e.text])).toEqual([
      ['ditambah', 'serial', 'satu'],
      ['diperbaiki', 'desktop', 'dua'],
      ['internal', 'ci', 'tiga'],
    ]);
  });

  test('menolak nama tanpa tanggal, huruf besar, atau ekstensi lain, dan pesan memuat nama berkas', () => {
    for (const bad of [
      'tombol.md',
      '2026-11-17-x.md',
      '20261117-Tombol.md',
      '20261117-x.txt',
      '20261117-.md',
    ]) {
      expect(() => parseFragment(bad, 'fix: isi')).toThrow(bad);
    }
    expect(FRAGMENT_NAME_PATTERN.test('20261117-a-b-c.md')).toBe(true);
  });

  test('menolak tanggal yang bukan tanggal kalender nyata (bulan 13, hari 32, 30 Februari); tahun kabisat diterima', () => {
    for (const bad of ['20261301-a.md', '20261132-a.md', '20260230-a.md', '20260000-a.md']) {
      expect(() => parseFragment(bad, 'fix: isi')).toThrow(bad);
    }
    expect(() => parseFragment('20240229-a.md', 'fix: isi')).not.toThrow();
  });

  test('menolak tipe tak dikenal, huruf besar, tanda baca salah, area tak sah, dan format lama "jenis: ..."', () => {
    for (const line of [
      'tambah: isi',
      'Feat: isi',
      'FIX: isi',
      'feat:isi',
      'feat : isi',
      'feat isi',
      'feat(Serial): isi',
      'feat(): isi',
      'feat(a b): isi',
      'feat(serial) isi',
      'feat(serial)): isi',
      'jenis: ditambah',
      'Isi saja tanpa tipe',
    ]) {
      expect(() => parseFragment('20261117-x.md', line), line).toThrow('20261117-x.md');
    }
  });

  test('menolak berkas kosong, teks butir kosong, baris lanjutan (bukan butir), CR, dan teks lebih dari batas', () => {
    const name = '20261117-x.md';
    expect(() => parseFragment(name, '')).toThrow(name);
    expect(() => parseFragment(name, '\n  \n')).toThrow(name);
    expect(() => parseFragment(name, 'fix: ')).toThrow(name);
    expect(() => parseFragment(name, 'fix(a):   ')).toThrow(name);
    expect(() => parseFragment(name, 'feat(a): satu\nlanjutan baris tanpa tipe')).toThrow(name);
    expect(() => parseFragment(name, 'fix: isi\r\nfix: dua')).toThrow(name);
    expect(() => parseFragment(name, `fix: ${'a'.repeat(FRAGMENT_MAX_CHARS + 1)}`)).toThrow(name);
    expect(
      parseFragment(name, `fix: ${'a'.repeat(FRAGMENT_MAX_CHARS)}`).entries[0]?.text,
    ).toHaveLength(FRAGMENT_MAX_CHARS);
  });

  test('galat menyebut nomor baris bila bermasalah di baris tertentu', () => {
    expect(() => parseFragment('20261117-x.md', 'fix: satu\nngawur')).toThrow('baris 2');
  });

  test('galat bertipe ChangelogError', () => {
    expect(() => parseFragment('x.md', '')).toThrow(ChangelogError);
  });
});

describe('semver', () => {
  test('isSemver ketat: tanpa awalan v, tanpa nol di depan, tanpa praprilis', () => {
    for (const ok of ['0.0.0', '1.0.0', '10.20.30']) expect(isSemver(ok)).toBe(true);
    for (const bad of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-rc1', '1.0.0.0', '', '1.a.0']) {
      expect(isSemver(bad)).toBe(false);
    }
  });

  test('compareSemver numerik, bukan string: 1.10.0 > 1.9.0', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('compileRelease', () => {
  const fragments = [
    frag('20261117-b.md', 'diperbaiki', 'Perbaikan B.'),
    frag('20261117-a.md', 'ditambah', 'Fitur A.'),
    frag('20261118-c.md', 'ditambah', 'Fitur C.'),
    frag('20261118-d.md', 'internal', 'Rapikan CI.'),
  ];

  test('dari berkas kosong: judul + bagian persis format spek, urutan jenis tetap, butir urut nama fragmen', () => {
    const out = compileRelease({
      title: 'Changelog server',
      existing: '',
      version: '1.4.0',
      date: '2026-11-17',
      fragments,
    });
    expect(out).toBe(
      [
        '# Changelog server',
        '',
        '## [1.4.0] - 2026-11-17',
        '### Ditambah',
        '- Fitur A.',
        '- Fitur C.',
        '### Diperbaiki',
        '- Perbaikan B.',
        '### Internal',
        '- Rapikan CI.',
        '',
      ].join('\n'),
    );
  });

  test('butir berarea diawali "area: " dan dikelompokkan per area (abjad); tanpa area di akhir; urutan asal dijaga dalam satu area', () => {
    const out = compileRelease({
      title: 'T',
      existing: '',
      version: '1.0.0',
      date: '2026-11-17',
      fragments: [
        frag('20261117-a.md', 'ditambah', 'Tanpa area A.'),
        frag('20261117-b.md', 'ditambah', 'Serial satu.', 'serial'),
        frag('20261117-c.md', 'ditambah', 'Postel satu.', 'postel'),
        frag('20261117-d.md', 'ditambah', 'Serial dua.', 'serial'),
        frag('20261117-e.md', 'ditambah', 'Tanpa area B.'),
      ],
    });
    expect(out).toContain(
      [
        '### Ditambah',
        '- postel: Postel satu.',
        '- serial: Serial satu.',
        '- serial: Serial dua.',
        '- Tanpa area A.',
        '- Tanpa area B.',
      ].join('\n'),
    );
  });

  test('beberapa butir dalam satu berkas ikut tersusun dan urutan barisnya dijaga', () => {
    const out = compileRelease({
      title: 'T',
      existing: '',
      version: '1.0.0',
      date: '2026-11-17',
      fragments: [
        {
          name: '20261117-a.md',
          entries: [
            { kind: 'ditambah', area: 'serial', text: 'satu' },
            { kind: 'diperbaiki', area: 'serial', text: 'dua' },
            { kind: 'ditambah', area: 'serial', text: 'tiga' },
          ],
        },
      ],
    });
    expect(out).toContain(
      '### Ditambah\n- serial: satu\n- serial: tiga\n### Diperbaiki\n- serial: dua',
    );
  });

  test('bagian baru tepat di bawah pengantar dan di atas versi lama; jenis kosong tidak ditulis', () => {
    const first = compileRelease({
      title: 'Changelog server',
      existing: '# Changelog server\n\nPengantar.\n',
      version: '1.0.0',
      date: '2026-11-10',
      fragments: [frag('20261110-a.md', 'diubah', 'Satu.')],
    });
    const second = compileRelease({
      title: 'Changelog server',
      existing: first,
      version: '1.1.0',
      date: '2026-11-17',
      fragments: [frag('20261117-a.md', 'ditambah', 'Dua.')],
    });
    expect(second.indexOf('Pengantar.')).toBeLessThan(second.indexOf('## [1.1.0]'));
    expect(second.indexOf('## [1.1.0]')).toBeLessThan(second.indexOf('## [1.0.0]'));
    expect(second).not.toContain('### Diubah\n- Dua.');
    expect(second.slice(second.indexOf('## [1.1.0]'), second.indexOf('## [1.0.0]'))).not.toContain(
      '### Diperbaiki',
    );
  });

  test('menolak versi yang sudah ada, versi/tanggal tak sah, dan nol fragmen', () => {
    const base = { title: 'T', date: '2026-11-17', fragments };
    const existing = compileRelease({ ...base, existing: '', version: '1.4.0' });
    expect(() => compileRelease({ ...base, existing, version: '1.4.0' })).toThrow('1.4.0');
    expect(() => compileRelease({ ...base, existing: '', version: 'v1.4.0' })).toThrow();
    expect(() =>
      compileRelease({ ...base, existing: '', version: '1.4.0', date: '17-11-2026' }),
    ).toThrow();
    expect(() =>
      compileRelease({ ...base, existing: '', version: '1.4.0', date: '2026-13-45' }),
    ).toThrow();
    expect(() =>
      compileRelease({ ...base, existing: '', version: '1.4.0', fragments: [] }),
    ).toThrow();
  });
});

describe('extractSection', () => {
  const log = [
    '# Changelog server',
    '',
    '## [1.2.0] - 2026-11-17',
    '### Ditambah',
    '- A.',
    '### Internal',
    '- B.',
    '',
    '## [11.2.0] - 2026-10-01',
    '### Diubah',
    '- C.',
    '',
  ].join('\n');

  test('mengembalikan satu bagian saja (termasuk Internal) dan tak tertukar 1.2.0 / 11.2.0 / 1.2.01', () => {
    expect(extractSection(log, '1.2.0')).toBe(
      '## [1.2.0] - 2026-11-17\n### Ditambah\n- A.\n### Internal\n- B.',
    );
    expect(extractSection(log, '11.2.0')).toBe('## [11.2.0] - 2026-10-01\n### Diubah\n- C.');
    expect(extractSection(log, '1.2.01')).toBeNull();
    expect(extractSection(log, '2.0.0')).toBeNull();
  });
});

function fakeDeps(
  files: Record<string, string>,
  opts: { failWrite?: boolean } = {},
): CliDeps & {
  files: Record<string, string>;
  out: string[];
} {
  const out: string[] = [];
  return {
    files,
    out,
    listDir: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
    readFile: (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`tak ada: ${p}`);
      return v;
    },
    writeFile: (p, c) => {
      if (opts.failWrite) throw new Error('disk penuh');
      files[p] = c;
    },
    removeFile: (p) => {
      delete files[p];
    },
    print: (line) => out.push(line),
  };
}

describe('realDeps.listDir', () => {
  const makeRoot = () => mkdtempSync(join(tmpdir(), 'qc-changelog-'));

  test('folder tidak ada = daftar kosong; subfolder dilaporkan dengan akhiran "/"; berkas biasa apa adanya', () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, 'server/changelog.d/sub'), { recursive: true });
      writeFileSync(join(root, 'server/changelog.d/20261117-a.md'), 'x');
      const deps = realDeps(root);
      expect(deps.listDir('desktop/changelog.d')).toEqual([]);
      expect(deps.listDir('server/changelog.d').sort()).toEqual(['20261117-a.md', 'sub/']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('galat selain ENOENT tidak ditelan (jalur yang adalah berkas, bukan folder)', () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, 'server'), { recursive: true });
      writeFileSync(join(root, 'server/changelog.d'), 'bukan folder');
      expect(() => realDeps(root).listDir('server/changelog.d')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('entri subfolder muncul sebagai masalah validasi (bukan diam-diam hilang)', () => {
    const deps: CliDeps = {
      listDir: () => ['sub/', '20261117-a.md'],
      readFile: () => 'fix: isi',
      writeFile: () => {},
      removeFile: () => {},
      print: () => {},
    };
    expect(runCli(['validate', 'server'], deps)).toBe(1);
  });
});

describe('runCli', () => {
  const dir = 'server/changelog.d';

  test('validate: lulus bila semua fragmen sah (.gitkeep diabaikan), gagal dan menyebut berkas bermasalah', () => {
    const ok = fakeDeps({
      [`${dir}/.gitkeep`]: '',
      [`${dir}/20261117-a.md`]: 'fix(web): isi',
    });
    expect(runCli(['validate', 'server'], ok)).toBe(0);
    const bad = fakeDeps({
      [`${dir}/20261117-a.md`]: 'salah: isi',
      [`${dir}/ngawur.md`]: 'x',
    });
    expect(runCli(['validate', 'server'], bad)).toBe(1);
    expect(bad.out.join('\n')).toContain('20261117-a.md');
    expect(bad.out.join('\n')).toContain('ngawur.md');
  });

  test('compile: menulis CHANGELOG lalu menghapus fragmen (bukan .gitkeep)', () => {
    const deps = fakeDeps({
      [`${dir}/.gitkeep`]: '',
      [`${dir}/20261117-a.md`]: 'feat(web): Fitur A.',
      'server/CHANGELOG.md': '# Changelog server\n',
    });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], deps)).toBe(0);
    expect(deps.files['server/CHANGELOG.md']).toContain('## [1.0.0] - 2026-11-17');
    expect(deps.files['server/CHANGELOG.md']).toContain('- web: Fitur A.');
    expect(
      Object.keys(deps.files).filter((p) => p.endsWith('.md') && p.includes('changelog.d')),
    ).toEqual([]);
    expect(`${dir}/.gitkeep` in deps.files).toBe(true);
  });

  test('compile: gagal menulis = fragmen tetap ada; fragmen rusak atau nol fragmen = tidak ada yang berubah', () => {
    const failing = fakeDeps(
      { [`${dir}/20261117-a.md`]: 'feat: Fitur A.', 'server/CHANGELOG.md': '# C\n' },
      { failWrite: true },
    );
    expect(() => runCli(['compile', 'server', '1.0.0', '2026-11-17'], failing)).toThrow(
      'disk penuh',
    );
    expect(`${dir}/20261117-a.md` in failing.files).toBe(true);

    const broken = fakeDeps({
      [`${dir}/20261117-a.md`]: 'salah: x',
      'server/CHANGELOG.md': '# C\n',
    });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], broken)).toBe(1);
    expect(broken.files['server/CHANGELOG.md']).toBe('# C\n');
    expect(`${dir}/20261117-a.md` in broken.files).toBe(true);

    const empty = fakeDeps({ 'server/CHANGELOG.md': '# C\n' });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], empty)).toBe(1);
  });

  test('compile dua kali untuk versi sama gagal tanpa mengubah apa pun', () => {
    const deps = fakeDeps({
      [`${dir}/20261117-a.md`]: 'feat: Fitur A.',
      'server/CHANGELOG.md': '# C\n',
    });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], deps)).toBe(0);
    deps.files[`${dir}/20261118-b.md`] = 'change: B.';
    const before = deps.files['server/CHANGELOG.md'];
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-18'], deps)).toBe(1);
    expect(deps.files['server/CHANGELOG.md']).toBe(before);
    expect(`${dir}/20261118-b.md` in deps.files).toBe(true);
  });

  test('extract: mencetak bagian; versi tak ada = keluar 1; komponen/perintah tak dikenal = keluar 1', () => {
    const deps = fakeDeps({
      'desktop/CHANGELOG.md': '# C\n\n## [1.0.0] - 2026-11-17\n### Diubah\n- X.\n',
    });
    expect(runCli(['extract', 'desktop', '1.0.0'], deps)).toBe(0);
    expect(deps.out.join('\n')).toContain('## [1.0.0] - 2026-11-17');
    expect(runCli(['extract', 'desktop', '2.0.0'], deps)).toBe(1);
    expect(runCli(['extract', 'web', '1.0.0'], deps)).toBe(1);
    expect(runCli(['bebas'], deps)).toBe(1);
  });
});
