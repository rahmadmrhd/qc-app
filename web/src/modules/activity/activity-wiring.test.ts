import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTIVITY_KINDS } from '@shared/audit';
import { expect, test } from 'vitest';

/** View pemakai `ViewMeta` (kecuali Serial, yang memakai `serials.history`) dan `kind` log aktivitasnya. */
const VIEWS: readonly [file: string, kind: string][] = [
  ['access/components/business-unit-detail-view.tsx', 'businessUnit'],
  ['access/components/location-view.tsx', 'location'],
  ['access/components/role-view.tsx', 'role'],
  ['access/components/user-view.tsx', 'user'],
  ['brand/components/brand-detail-view.tsx', 'brand'],
  ['customer/components/customer-view.tsx', 'customer'],
  ['handover/components/handover-detail-view.tsx', 'handover'],
  ['item/components/item-detail-view.tsx', 'item'],
  ['postel/components/postel-view.tsx', 'postel'],
  ['qrcode/components/qr-design-view.tsx', 'qrDesign'],
  ['qrcode/components/qr-preset-view.tsx', 'qrPreset'],
  ['sticker/components/sticker-type-view.tsx', 'stickerType'],
  ['sticker/components/sticker-view.tsx', 'sticker'],
];

/**
 * Jenis yang sah tanpa View: log tautan publik dashboard dibaca lewat `activity.list` (pemegang `dashboard: manage`),
 * tetapi tautan tidak punya halaman View (daftarnya dialog "Tautan dibagikan"), jadi belum ada panel log di UI.
 */
const KINDS_WITHOUT_VIEW: readonly string[] = ['dashboardShare'];

const modules = path.resolve(__dirname, '..');

test('tiap View pemakai ViewMeta memasang ActivityLog dengan kind yang tepat', () => {
  for (const [file, kind] of VIEWS) {
    const source = readFileSync(path.join(modules, file), 'utf8');
    expect(source, file).toContain(`<ActivityLog kind="${kind}" id={`);
    expect(source, file).toContain("from '@/modules/activity/components/activity-log'");
  }
});

test('semua jenis ActivityKind dilayani tepat satu View (kecuali yang tercatat tanpa View)', () => {
  const served = [...VIEWS.map(([, kind]) => kind), ...KINDS_WITHOUT_VIEW].sort();
  expect(served).toEqual([...ACTIVITY_KINDS].sort());
  // Jenis tanpa View tidak boleh juga terdaftar sebagai View (daftar pengecualian tak boleh basi).
  for (const kind of KINDS_WITHOUT_VIEW) {
    expect(
      VIEWS.some(([, viewKind]) => viewKind === kind),
      kind,
    ).toBe(false);
  }
});

test('log aktivitas tidak masuk whitelist query-persist', () => {
  const source = readFileSync(path.join(modules, '../app/query-persist.ts'), 'utf8');
  expect(source).not.toMatch(/'activity\b/);
});
