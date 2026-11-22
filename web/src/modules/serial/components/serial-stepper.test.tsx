import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { STEP_ORDER } from '../lib/labels';
import { caseStepperState, SerialStepper, stepIndexOf } from './serial-stepper';

test('tiap tahap kecuali yang terakhir memuat ikon panah SETELAH chip di <li> yang sama; tanpa karakter "→"', () => {
  render(<SerialStepper status="reported" hasCases />);
  const steps = within(screen.getByRole('list', { name: 'Tahap' })).getAllByRole('listitem');
  expect(steps).toHaveLength(STEP_ORDER.length);
  steps.forEach((step, index) => {
    const arrow = step.querySelector('svg');
    if (index === steps.length - 1) {
      expect(arrow).toBeNull();
      return;
    }
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    // Chip lebih dulu, panah sesudahnya (agar tak menggantung di awal baris saat terbungkus).
    const chip = step.querySelector('span') as HTMLElement;
    expect(chip.compareDocumentPosition(arrow as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(screen.getByRole('list', { name: 'Tahap' })).not.toHaveTextContent('→');
});

test('tahap sekarang ditandai aria-current; tahap akhir berlabel Rusak atau Lolos menurut status', () => {
  const { rerender } = render(<SerialStepper status="broken" hasCases />);
  const current = () =>
    within(screen.getByRole('list', { name: 'Tahap' }))
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
  expect(current()).toHaveLength(1);
  expect(current()[0]).toHaveTextContent('Rusak');
  rerender(<SerialStepper status="good" hasCases />);
  expect(current()[0]).toHaveTextContent('Lolos');
  expect(stepIndexOf('good', true)).toBe(6);
  expect(stepIndexOf('good', false)).toBe(0);
});

test('caseStepperState: laporan terbuka memakai status Serial kini; selesai rusak = Rusak; selesai lolos = Lolos', () => {
  expect(caseStepperState({ status: 'at_service', closedOn: null, outcome: null })).toEqual({
    status: 'at_service',
    hasCases: true,
  });
  expect(caseStepperState({ status: 'broken', closedOn: '2026-11-15', outcome: 'broken' })).toEqual(
    { status: 'broken', hasCases: true },
  );
  expect(caseStepperState({ status: 'good', closedOn: '2026-11-15', outcome: 'good' })).toEqual({
    status: 'good',
    hasCases: true,
  });
  // Laporan selesai tanpa hasil (tak semestinya ada): jatuh ke status Serial kini.
  expect(caseStepperState({ status: 'recheck', closedOn: '2026-11-15', outcome: null })).toEqual({
    status: 'recheck',
    hasCases: true,
  });
});
