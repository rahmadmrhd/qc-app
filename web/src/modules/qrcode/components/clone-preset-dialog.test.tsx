import type { QrPresetDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, QR_LIMITS } from '@shared/qrcode';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { ClonePresetDialog } from './clone-preset-dialog';

const source: QrPresetDto = {
  id: 'p1',
  name: 'Standar Spectrum',
  title: '',
  subtitle: '',
  footer: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu1',
  namePlacement: 'title',
  createdAt: 't',
  createdBy: 'a',
  updatedAt: 't',
  updatedBy: 'a',
};
const BUS = [
  { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' as const },
  { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' as const },
  { id: 'bu3', code: 'ARC', name: 'Arcadia', status: 'active' as const },
  { id: 'bu4', code: 'OLD', name: 'Lama', status: 'inactive' as const },
];

function renderDialog(onClone = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ClonePresetDialog
      open
      onOpenChange={vi.fn()}
      source={source}
      businessUnits={BUS}
      presets={[source, { ...source, id: 'p2', name: 'Nexus', buId: 'bu2' }]}
      onClone={onClone}
    />,
  );
  return onClone;
}

beforeEach(() => {
  resetUnsavedChangesForTests();
});

test('mengubah nama salinan mendaftarkan perubahan belum disimpan; nilai awal tidak', async () => {
  renderDialog();
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(screen.getByLabelText('Nama preset baru'), ' baru');
  expect(hasUnsavedChanges()).toBe(true);
});

test('BU yang sudah punya preset dan BU nonaktif tidak ditawarkan', async () => {
  renderDialog();
  const dialog = screen.getByRole('dialog');
  expect(await linkOptionNames(within(dialog), 'Business Unit tujuan')).toEqual(['Arcadia']);
});

test('nama awal bukan nama sumber (nama preset unik): "<nama> (salinan)", dengan batas panjang dari QR_LIMITS', () => {
  renderDialog();
  const name = screen.getByLabelText('Nama preset baru');
  expect(name).toHaveValue('Standar Spectrum (salinan)');
  expect(name).toHaveAttribute('maxlength', String(QR_LIMITS.presetName));
});

test('memilih BU tujuan dan nama baru lalu mengirim kloning; tombol nonaktif sebelum lengkap', async () => {
  const onClone = renderDialog();
  const dialog = screen.getByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Kloning' });
  expect(submit).toBeDisabled();
  await pickLink(within(dialog), 'Business Unit tujuan', 'Arcadia');
  const name = within(dialog).getByLabelText('Nama preset baru');
  await userEvent.clear(name);
  await userEvent.type(name, 'Standar Arcadia');
  await userEvent.click(submit);
  expect(onClone).toHaveBeenCalledWith({ id: 'p1', buId: 'bu3', name: 'Standar Arcadia' });
});
