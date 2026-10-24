import { describe, expect, test } from 'bun:test';
import { checkDist, type DistFile, MAX_CHUNK_GZIP_BYTES } from './verify-dist';

const html: DistFile = {
  file: 'index.html',
  text: '<html><script type="module" crossorigin src="/assets/index-abc.js"></script></html>',
  gzipBytes: 100,
};
const js = (name: string, text = 'ok', gzipBytes = 1000): DistFile => ({
  file: `assets/${name}`,
  text,
  gzipBytes,
});

describe('checkDist', () => {
  test('keluaran berpotongan yang sehat lolos', () => {
    expect(checkDist([html, js('index-abc.js'), js('route-x.js')])).toEqual([]);
  });
  test('tanpa index.html atau tanpa JS gagal', () => {
    expect(checkDist([js('a.js')])).toContain('worker/dist/index.html tidak ada');
    expect(checkDist([html]).join()).toContain('tidak ada potongan JS');
  });
  test('penanda boot Apps Script dan kode mock ditolak', () => {
    const bad = { ...html, text: `${html.text}<script>window.__BOOT__='__QC_BOOT__'</script>` };
    expect(checkDist([bad, js('a.js')]).join()).toContain('penanda boot');
    expect(checkDist([html, js('a.js', 'const k="mock-secret"')]).join()).toContain('mock');
  });
  test('potongan melebihi anggaran gzip ditolak per potongan', () => {
    const problems = checkDist([
      html,
      js('besar.js', 'x', MAX_CHUNK_GZIP_BYTES + 1),
      js('kecil.js'),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('besar.js');
  });
});
