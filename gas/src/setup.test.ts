import { expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { runSetup_ } from './setup';

test('melaporkan Script Property yang belum diset dan tidak membuat sheet tanpa SPREADSHEET_ID', () => {
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  const report = runSetup_();
  expect(report).toContain('SPREADSHEET_ID');
  expect(report).toContain('SESSION_SECRET');
  expect(platform.db.sheets.size).toBe(0);
});

test('membuat sheet users, roles, audit_log beserta header', () => {
  const platform = createMemoryPlatform({
    properties: {
      SPREADSHEET_ID: 'x',
      OAUTH_CLIENT_ID: 'a',
      OAUTH_CLIENT_SECRET: 'b',
      OAUTH_REDIRECT_URI: 'c',
      SESSION_SECRET: 'd',
      ADMIN_EMAIL: 'e@gmail.com',
    },
  });
  setPlatform_(platform);
  expect(runSetup_()).toContain('Script Properties lengkap.');
  expect([...platform.db.sheets.keys()]).toEqual(['users', 'roles', 'audit_log']);
  expect(platform.db.sheet('users').rows[0]?.[1]).toBe('email');
  expect(platform.db.sheet('audit_log').rows[0]).toEqual([
    'ts',
    'actor',
    'action',
    'target',
    'before',
    'after',
  ]);
});

test('memigrasi audit_log lama: detail dipindah ke after, detail before/after dipecah', () => {
  const platform = createMemoryPlatform({
    properties: {
      SPREADSHEET_ID: 'x',
      OAUTH_CLIENT_ID: 'a',
      OAUTH_CLIENT_SECRET: 'b',
      OAUTH_REDIRECT_URI: 'c',
      SESSION_SECRET: 'd',
      ADMIN_EMAIL: 'e@gmail.com',
    },
  });
  setPlatform_(platform);
  platform.db
    .insertSheet('audit_log')
    .rows.push(
      ['ts', 'actor', 'action', 'target', 'detail'],
      ['t1', 'e@gmail.com', 'user.create', 'a@gmail.com', '{"name":"A"}'],
      [
        't2',
        'e@gmail.com',
        'user.update',
        'a@gmail.com',
        '{"before":{"name":"A"},"after":{"name":"B"}}',
      ],
      ['t3', 'e@gmail.com', 'user.deactivate', 'a@gmail.com', 'null'],
    );
  runSetup_();
  runSetup_();
  const rows = platform.db.sheet('audit_log').rows;
  const header = rows[0] ?? [];
  const cell = (row: number, name: string): unknown => rows[row]?.[header.indexOf(name)];
  expect(cell(1, 'before')).toBe('null');
  expect(cell(1, 'after')).toBe('{"name":"A"}');
  expect(cell(2, 'before')).toBe('{"name":"A"}');
  expect(cell(2, 'after')).toBe('{"name":"B"}');
  expect(cell(3, 'before')).toBe('null');
  expect(cell(3, 'after')).toBe('null');
  expect([1, 2, 3].map((row) => cell(row, 'detail'))).toEqual(['', '', '']);
});
