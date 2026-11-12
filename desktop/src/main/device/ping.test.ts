import { describe, expect, test } from 'vitest';
import { pingOnce } from './ping';

const runWith = (output: string) => async () => output;

describe('pingOnce', () => {
  test('TTL= ada → success, berbahasa Inggris maupun Indonesia', async () => {
    const english =
      'Reply from 192.168.88.1: bytes=32 time<1ms TTL=64\r\n\r\nPing statistics for 192.168.88.1:';
    const indonesian = 'Balasan dari 192.168.88.1: byte=32 waktu<1ms TTL=64';
    expect(await pingOnce('192.168.88.1', 1000, runWith(english))).toEqual({
      ok: true,
      kind: 'success',
    });
    expect(await pingOnce('192.168.88.1', 1000, runWith(indonesian))).toEqual({
      ok: true,
      kind: 'success',
    });
  });

  test('"Destination host unreachable" dengan kode keluar 0 → unreachable, bukan success', async () => {
    // ping.exe Windows keluar 0 walau tujuan tak terjangkau, dan baris balasan memuat "Reply from"
    // (dari gateway) tetapi TIDAK memuat TTL=.
    const out =
      'Pinging 192.168.88.50 with 32 bytes of data:\r\nReply from 192.168.88.2: Destination host unreachable.\r\n';
    expect(await pingOnce('192.168.88.50', 1000, runWith(out))).toEqual({
      ok: false,
      kind: 'unreachable',
    });
    const id = 'Balasan dari 192.168.88.2: Tujuan host tidak terjangkau.';
    expect((await pingOnce('192.168.88.50', 1000, runWith(id))).kind).toBe('unreachable');
  });

  test('"Request timed out"/"Waktu permintaan habis" → timeout', async () => {
    expect(await pingOnce('10.0.0.9', 1000, runWith('Request timed out.'))).toEqual({
      ok: false,
      kind: 'timeout',
    });
    expect((await pingOnce('10.0.0.9', 1000, runWith('Waktu permintaan habis.'))).kind).toBe(
      'timeout',
    );
  });

  test('ping gagal dijalankan → error', async () => {
    const run = async () => {
      throw new Error('spawn ping.exe ENOENT');
    };
    expect(await pingOnce('10.0.0.9', 1000, run)).toEqual({ ok: false, kind: 'error' });
  });

  test('keluaran tak dikenal diperlakukan sebagai timeout (status lain)', async () => {
    expect((await pingOnce('10.0.0.9', 1000, runWith('aneh'))).kind).toBe('timeout');
    expect((await pingOnce('10.0.0.9', 1000, runWith(''))).kind).toBe('timeout');
  });

  test('host tak sah ditolak sebelum menjalankan proses (tanpa injeksi argumen)', async () => {
    let called = false;
    const run = async () => {
      called = true;
      return 'TTL=64';
    };
    expect(await pingOnce('1.2.3.4 & calc', 1000, run)).toEqual({ ok: false, kind: 'error' });
    expect(await pingOnce('-n 100 1.2.3.4', 1000, run)).toEqual({ ok: false, kind: 'error' });
    expect(called).toBe(false);
  });
});
