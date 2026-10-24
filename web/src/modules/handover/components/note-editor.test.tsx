import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { NoteEditor } from './note-editor';

function Harness({ onValue }: { onValue: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <span id="lbl">Catatan</span>
      <NoteEditor
        id="note"
        labelledBy="lbl"
        value={value}
        onChange={(next) => {
          onValue(next);
          setValue(next);
        }}
      />
    </>
  );
}

test('editor Catatan: tanpa tombol gambar, ada checklist, batas 5000, nama field dari label', async () => {
  const onValue = vi.fn();
  render(<Harness onValue={onValue} />);
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Gambar' })).not.toBeInTheDocument();
  expect(screen.getByText('0/5000')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'A b');
  await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('- [ ] A b'));
});
