import { describe, expect, test } from 'vitest';
import { createSseParser, SSE_MAX_BUFFER_CHARS } from './sse';

describe('createSseParser', () => {
  test('satu bingkai lengkap: event, id, data', () => {
    const parser = createSseParser();
    expect(parser.push('id: a|b\nevent: notification\ndata: {"x":1}\n\n')).toEqual([
      { event: 'notification', id: 'a|b', data: '{"x":1}' },
    ]);
  });

  test('bingkai terpotong di tengah digabung antar potongan', () => {
    const parser = createSseParser();
    expect(parser.push('event: notif')).toEqual([]);
    expect(parser.push('ication\ndata: hal')).toEqual([]);
    expect(parser.push('o\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'notification', id: null, data: 'halo' }]);
  });

  test('komentar detak jantung dan baris kosong diabaikan; bingkai ready tetap lewat', () => {
    const parser = createSseParser();
    expect(parser.push(': ping\n\n')).toEqual([]);
    expect(parser.push('retry: 3000\nevent: ready\ndata: {}\n\n')).toEqual([
      { event: 'ready', id: null, data: '{}' },
    ]);
  });

  test('CRLF dan beberapa data digabung dengan baris baru; beberapa bingkai sekaligus', () => {
    const parser = createSseParser();
    expect(parser.push('data: a\r\ndata: b\r\n\r\nevent: x\r\ndata: c\r\n\r\n')).toEqual([
      { event: 'message', id: null, data: 'a\nb' },
      { event: 'x', id: null, data: 'c' },
    ]);
  });

  test('CRLF yang terbelah di antara dua potongan tidak menggandakan baris', () => {
    const parser = createSseParser();
    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ event: 'message', id: null, data: 'a' }]);
  });

  test('id berisi NUL diabaikan', () => {
    const parser = createSseParser();
    expect(parser.push('id: a\0b\ndata: x\n\n')).toEqual([
      { event: 'message', id: null, data: 'x' },
    ]);
  });

  test('buffer melewati batas = galat (aliran rusak)', () => {
    const parser = createSseParser();
    expect(() => parser.push('d'.repeat(SSE_MAX_BUFFER_CHARS + 1))).toThrow();
  });
});
