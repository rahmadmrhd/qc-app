import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { meQueryKey } from '@/modules/auth/queries';
import { NoteEditor } from '../components/note-editor';

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

function renderEditor(permissions: Record<string, string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, { permissions } as unknown as MeDto);
  const onValue = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Harness onValue={onValue} />
    </QueryClientProvider>,
  );
  return onValue;
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    items: [
      { id: 'i1', brandName: 'Tenda', model: 'AX300' },
      { id: 'i2', brandName: 'Tenda', model: 'AC10' },
    ],
    truncated: false,
  });
});

test('mengetik di baris checklist memunculkan saran; Tab menyisipkan nama Item sebagai teks polos', async () => {
  const onValue = renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('items.nameOptions', null));
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  const box = screen.getByRole('textbox', { name: 'Catatan' });
  await userEvent.type(box, 'tenda ax');
  expect(await screen.findByRole('option', { name: 'Tenda AX300' })).toBeInTheDocument();
  await userEvent.keyboard('{Tab}');
  await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('- [ ] Tenda AX300'));
});

test('di paragraf biasa (bukan checklist) tidak ada saran', async () => {
  renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'tenda ax');
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

test('Enter tanpa sorotan tidak menerima saran (membuat baris baru)', async () => {
  const onValue = renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'tenda ax');
  await screen.findByRole('option', { name: 'Tenda AX300' });
  await userEvent.keyboard('{Enter}');
  await waitFor(() => {
    const last = onValue.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('tenda ax');
    expect(last).not.toContain('Tenda AX300');
  });
});

test('panah bawah menyorot lalu Enter menerima yang disorot', async () => {
  const onValue = renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'tenda');
  await screen.findByRole('option', { name: 'Tenda AC10' });
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(onValue.mock.calls.at(-1)?.[0]).toMatch(/^- \[ \] Tenda A[CX]/));
});

test('tanpa hak item tidak memanggil rute dan tidak ada saran', async () => {
  renderEditor({});
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'tenda ax');
  expect(apiMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

function pasteInto(box: HTMLElement, text: string) {
  fireEvent.paste(box, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      types: ['text/plain'],
      files: [],
    },
  });
}

test('Esc menutup saran', async () => {
  renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'tenda ax');
  await screen.findByRole('option', { name: 'Tenda AX300' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
});

test('tempelan WhatsApp (dikonversi) tidak memunculkan saran walau ujungnya cocok nama Item', async () => {
  renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  const box = screen.getByRole('textbox', { name: 'Catatan' });
  await userEvent.click(box);
  pasteInto(box, 'Orderan :\nTenda AX300 = 1 tenda ax');
  await waitFor(() => expect(box.textContent).toContain('1 tenda ax'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

test('tempelan teks biasa (jalur bawaan) di baris checklist tidak memunculkan saran', async () => {
  renderEditor({ item: 'view' });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  const box = screen.getByRole('textbox', { name: 'Catatan' });
  pasteInto(box, 'tenda ax');
  await waitFor(() => expect(box.textContent).toContain('tenda ax'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});
