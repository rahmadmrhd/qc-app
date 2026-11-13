import type { MeDto } from '@shared/contract';
import { describe, expect, test } from 'vitest';
import { resolveSteps } from './resolve-steps';
import type { GuideEntry, GuideStep } from './types';

const me = {
  email: 'a@qc.local',
  name: 'A',
  isSuperAdmin: false,
  permissions: { item: 'view' },
  locations: [],
  businessUnits: [],
  sharedAccount: false,
} as unknown as MeDto;

function step(overrides: Partial<GuideStep> = {}): GuideStep {
  return { target: 'x', text: 't', advance: 'next', ...overrides };
}

function entry(steps: GuideStep[]): GuideEntry {
  return { id: 'g', kind: 'dasar', status: 'disimpan', version: 1, title: 'T', steps };
}

const present =
  (...targets: string[]) =>
  (target: string) =>
    targets.includes(target) ? document.body : null;

describe('resolveSteps', () => {
  test('membuang langkah yang izinnya tidak terpenuhi', () => {
    const open = step({ target: 'a' });
    const closed = step({ target: 'b', izin: { module: 'access', level: 'manage' } });
    expect(resolveSteps(entry([open, closed]), me, undefined, present('a', 'b'))).toEqual([open]);
  });

  test('langkah di halaman sekarang (tanpa route) tanpa target dibuang', () => {
    const here = step({ target: 'ada' });
    const ghost = step({ target: 'hantu' });
    expect(resolveSteps(entry([here, ghost]), me, undefined, present('ada'))).toEqual([here]);
  });

  test('langkah ber-route dipertahankan walau targetnya belum ada (muncul setelah navigasi)', () => {
    const later = step({ target: 'nanti', route: '/item' });
    expect(resolveSteps(entry([later]), me, undefined, present())).toEqual([later]);
  });

  test('urutan dipertahankan', () => {
    const steps = [step({ target: 'a' }), step({ target: 'b' }), step({ target: 'c' })];
    expect(resolveSteps(entry(steps), me, undefined, present('a', 'b', 'c'))).toEqual(steps);
  });
});
