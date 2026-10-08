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
});
