import { expect, test } from 'vitest';
import { designLabel } from './design-label';

test('label konfigurasi: title saja, atau "title — subtitle" bila subtitle ada', () => {
  expect(designLabel({ title: 'Panduan Instalasi', subtitle: '' })).toBe('Panduan Instalasi');
  expect(designLabel({ title: 'Panduan Instalasi', subtitle: '   ' })).toBe('Panduan Instalasi');
  expect(designLabel({ title: 'Panduan Instalasi', subtitle: 'USW PRO MAX 48 PoE' })).toBe(
    'Panduan Instalasi — USW PRO MAX 48 PoE',
  );
});
