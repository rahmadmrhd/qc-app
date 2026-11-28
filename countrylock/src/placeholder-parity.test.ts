import { expect, test } from 'bun:test';
import { PLACEHOLDER_NAMES } from '../../shared/countrylock-bundle';
import { PLACEHOLDERS } from './script-template';

// Daftar placeholder yang divalidasi server (shared) harus sama dengan yang dirender desktop.
test('PLACEHOLDER_NAMES (shared) sama dengan PLACEHOLDERS (script-template)', () => {
  expect([...PLACEHOLDER_NAMES].sort()).toEqual([...PLACEHOLDERS].sort());
});
