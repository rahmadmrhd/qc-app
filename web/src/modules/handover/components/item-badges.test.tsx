import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

import { meQueryKey } from '@/modules/auth/queries';
import { itemNameKeys } from '../lib/item-names';
import { NoteView } from './note-view';

function renderView(permissions: Record<string, string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, { permissions } as unknown as MeDto);
  client.setQueryData(itemNameKeys.all, {
    items: [{ id: 'i1', brandName: 'Tenda', model: 'AX300' }],
    truncated: false,
  });
  render(
    <QueryClientProvider client={client}>
      <NoteView
        note={'- [ ] Tenda AX300 = 2\n- [ ] kabel = 1'}
        checklist={[
          { index: 0, text: 'Tenda AX300 = 2', checked: false, by: '', at: '' },
          { index: 1, text: 'kabel = 1', checked: false, by: '', at: '' },
        ]}
        comments={[]}
        canCheck
        canComment={false}
        onCheck={() => {}}
        onComment={() => {}}
      />
    </QueryClientProvider>,
  );
}

test('pembaca ber-item:view melihat lencana Item di baris dan ringkasan', () => {
  renderView({ item: 'view' });
  // satu di ujung baris, satu di ringkasan
  expect(screen.getAllByText('Tenda AX300')).toHaveLength(2);
  expect(screen.getByText('Item terdeteksi:')).toBeInTheDocument();
});

test('pembaca tanpa hak item tidak melihat lencana', () => {
  renderView({});
  expect(screen.queryByText('Item terdeteksi:')).not.toBeInTheDocument();
});
