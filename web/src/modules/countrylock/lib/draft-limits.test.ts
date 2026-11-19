import { DRAFT_MAX_ROWS } from '@countrylock/bridge-channels';
import { SERIAL_LIMITS } from '@shared/serials';
import { expect, test } from 'vitest';

// `countrylock/` tak mengimpor nilai dari `shared/`: batas baris draft di jembatan harus sama dengan batas tabel web.
test('DRAFT_MAX_ROWS sama dengan SERIAL_LIMITS.tableRows', () => {
  expect(DRAFT_MAX_ROWS).toBe(SERIAL_LIMITS.tableRows);
});
