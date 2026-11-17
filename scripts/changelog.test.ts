import { describe, expect, test } from 'bun:test';
import {
  ChangelogError,
  type CliDeps,
  compareSemver,
  compileRelease,
  extractSection,
  FRAGMENT_NAME_PATTERN,
  isSemver,
  parseFragment,
  runCli,
} from './changelog';

const frag = (name: string, kind: string, text: string) => ({
  name,
  kind: kind as 'ditambah',
  text,
});

describe('parseFragment', () => {
  test('menerima jenis dan satu paragraf; baris dalam paragraf digabung dengan spasi', () => {
    expect(
      parseFragment('20261117-tombol-baru.md', 'jenis: ditambah\nTombol baru di beranda.\n'),
    ).toEqual({
      name: '20261117-tombol-baru.md',
      kind: 'ditambah',
      text: 'Tombol baru di beranda.',
    });
    expect(parseFragment('20261117-a.md', 'jenis: diubah\nBaris satu\nbaris dua.').text).toBe(
      'Baris satu baris dua.',
    );
  });

  test('menolak nama tanpa tanggal, huruf besar, atau ekstensi lain, dan pesan memuat nama berkas', () => {
    for (const bad of [
      'tombol.md',
      '2026-11-17-x.md',
      '20261117-Tombol.md',
      '20261117-x.txt',
      '20261117-.md',
    ]) {
      expect(() => parseFragment(bad, 'jenis: diubah\nIsi.')).toThrow(bad);
    }
    expect(FRAGMENT_NAME_PATTERN.test('20261117-a-b-c.md')).toBe(true);
  });

  test('menolak baris pertama bukan "jenis: ...", jenis tak dikenal, atau salah ketik', () => {
    for (const first of [
      '',
      'Isi saja',
      'jenis:ditambah',
      'jenis: tambah',
      'Jenis: ditambah',
      'jenis: Ditambah',
    ]) {
      expect(() => parseFragment('20261117-x.md', `${first}\nIsi.`)).toThrow('20261117-x.md');
    }
  });

  test('menolak badan kosong, dua paragraf, CR, dan badan lebih dari 500 karakter', () => {
    const name = '20261117-x.md';
    expect(() => parseFragment(name, 'jenis: diubah\n')).toThrow(name);
    expect(() => parseFragment(name, 'jenis: diubah\n   \n')).toThrow(name);
    expect(() => parseFragment(name, 'jenis: diubah\nSatu.\n\nDua.')).toThrow(name);
    expect(() => parseFragment(name, 'jenis: diubah\r\nIsi.')).toThrow(name);
    expect(() => parseFragment(name, `jenis: diubah\n${'a'.repeat(501)}`)).toThrow(name);
    expect(parseFragment(name, `jenis: diubah\n${'a'.repeat(500)}`).text).toHaveLength(500);
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

describe('runCli', () => {
  const dir = 'server/changelog.d';

  test('validate: lulus bila semua fragmen sah (.gitkeep diabaikan), gagal dan menyebut berkas bermasalah', () => {
    const ok = fakeDeps({
      [`${dir}/.gitkeep`]: '',
      [`${dir}/20261117-a.md`]: 'jenis: diubah\nIsi.',
    });
    expect(runCli(['validate', 'server'], ok)).toBe(0);
    const bad = fakeDeps({
      [`${dir}/20261117-a.md`]: 'jenis: salah\nIsi.',
      [`${dir}/ngawur.md`]: 'x',
    });
    expect(runCli(['validate', 'server'], bad)).toBe(1);
    expect(bad.out.join('\n')).toContain('20261117-a.md');
    expect(bad.out.join('\n')).toContain('ngawur.md');
  });

  test('compile: menulis CHANGELOG lalu menghapus fragmen (bukan .gitkeep)', () => {
    const deps = fakeDeps({
      [`${dir}/.gitkeep`]: '',
      [`${dir}/20261117-a.md`]: 'jenis: ditambah\nFitur A.',
      'server/CHANGELOG.md': '# Changelog server\n',
    });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], deps)).toBe(0);
    expect(deps.files['server/CHANGELOG.md']).toContain('## [1.0.0] - 2026-11-17');
    expect(
      Object.keys(deps.files).filter((p) => p.endsWith('.md') && p.includes('changelog.d')),
    ).toEqual([]);
    expect(`${dir}/.gitkeep` in deps.files).toBe(true);
  });

  test('compile: gagal menulis = fragmen tetap ada; fragmen rusak atau nol fragmen = tidak ada yang berubah', () => {
    const failing = fakeDeps(
      { [`${dir}/20261117-a.md`]: 'jenis: ditambah\nFitur A.', 'server/CHANGELOG.md': '# C\n' },
      { failWrite: true },
    );
    expect(() => runCli(['compile', 'server', '1.0.0', '2026-11-17'], failing)).toThrow(
      'disk penuh',
    );
    expect(`${dir}/20261117-a.md` in failing.files).toBe(true);

    const broken = fakeDeps({
      [`${dir}/20261117-a.md`]: 'jenis: salah\nx',
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
      [`${dir}/20261117-a.md`]: 'jenis: ditambah\nFitur A.',
      'server/CHANGELOG.md': '# C\n',
    });
    expect(runCli(['compile', 'server', '1.0.0', '2026-11-17'], deps)).toBe(0);
    deps.files[`${dir}/20261118-b.md`] = 'jenis: diubah\nB.';
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
