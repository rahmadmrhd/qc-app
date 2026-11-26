import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');

function block(start: string): string {
  const i = css.indexOf(start);
  expect(i).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('\n}', i));
}

const light = block(':root {');
const dark = block('.dark {');
const theme = block('@theme inline {');

const TOKENS = [
  'success',
  'success-foreground',
  'success-text',
  'warning',
  'warning-foreground',
  'warning-text',
  'info',
  'info-foreground',
  'info-text',
  'destructive-foreground',
  'destructive-text',
  'secondary-text',
  ...['primary', 'secondary', 'success', 'warning', 'info', 'destructive'].flatMap((c) => [
    `${c}-disabled`,
    `${c}-disabled-foreground`,
  ]),
];

describe('token warna semantik', () => {
  it.each(TOKENS)('token --%s ada di terang dan gelap', (t) => {
    expect(light).toContain(`--${t}:`);
    expect(dark).toContain(`--${t}:`);
  });

  it('nilai gelap sesuai spek', () => {
    expect(dark).toContain('--success-text: #22c55e;');
    expect(dark).toContain('--info-text: #60a5fa;');
    expect(dark).toContain('--destructive: #dc2626;');
    expect(dark).toContain('--warning: #b45309;');
  });

  it('nilai terang sesuai spek', () => {
    expect(light).toContain('--success: #15803d;');
    expect(light).toContain('--warning-text: #92400e;');
    expect(light).toContain('--secondary: #475569;');
    expect(light).toContain('--destructive-text: #b91c1c;');
  });

  it.each(TOKENS)('@theme inline memetakan --color-%s', (t) => {
    expect(theme).toContain(`--color-${t}: var(--${t});`);
  });
});
