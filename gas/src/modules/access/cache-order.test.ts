import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location, role, user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { UserContext } from './context';
import { loadUserContext_ } from './context';
import { saveLocation_, setLocationStatus_ } from './location-service';
import { insertLocation_, insertRole_, insertUser_ } from './repo';
import { removeRole_, saveRole_, saveUser_, setUserStatus_ } from './service';

let platform: MemoryPlatform;
let admin: UserContext;
let invalidatedAtAuditRows: number[];

const auditRows = () => platform.db.sheets.get('audit_log')?.rows.length ?? 0;

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } });
  setPlatform_(platform);
  insertRole_(role({ id: 'r1', name: 'Satu' }));
  insertRole_(role({ id: 'r2', name: 'Dua' }));
  insertLocation_(location({ id: 'l-a', code: 'A' }));
  insertUser_(user({ id: 'u1', email: 'budi@gmail.com', roleIds: ['r1'] }));
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  invalidatedAtAuditRows = [];
  const cachePut = platform.cachePut;
  platform.cachePut = (key, value, ttl) => {
    if (key === 'access:version') invalidatedAtAuditRows.push(auditRows());
    cachePut(key, value, ttl);
  };
});

/** Cache dibatalkan segera setelah data ditulis, sebelum audit: kegagalan audit tidak boleh meninggalkan izin basi. */
function expectInvalidatedBeforeAudit(run: () => unknown) {
  const before = auditRows();
  run();
  expect(invalidatedAtAuditRows).toEqual([before]);
  expect(auditRows()).toBeGreaterThan(before);
}

test('user: simpan dan ubah status', () => {
  expectInvalidatedBeforeAudit(() =>
    saveUser_(
      { id: 'u1', email: 'budi@gmail.com', name: 'B', status: 'active', assignments: [] },
      admin,
    ),
  );
  invalidatedAtAuditRows = [];
  expectInvalidatedBeforeAudit(() => setUserStatus_({ id: 'u1', status: 'inactive' }, admin));
});

test('role: simpan dan hapus', () => {
  expectInvalidatedBeforeAudit(() =>
    saveRole_({ id: 'r2', name: 'Dua B', description: '', permissions: {} }, admin),
  );
  invalidatedAtAuditRows = [];
  expectInvalidatedBeforeAudit(() => removeRole_({ id: 'r2' }, admin));
});

test('lokasi: simpan dan ubah status', () => {
  expectInvalidatedBeforeAudit(() => saveLocation_({ id: 'l-a', code: 'A', name: 'Baru' }, admin));
  invalidatedAtAuditRows = [];
  expectInvalidatedBeforeAudit(() => setLocationStatus_({ id: 'l-a', status: 'inactive' }, admin));
});
