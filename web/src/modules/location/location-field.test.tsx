import type { MeDto } from '@shared/rpc';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from './active-locations-context';
import { LocationField } from './location-field';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', stock: 'none' },
    locations: [
      {
        id: 'l-a',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { item: 'manage', handover: 'none', stock: 'none' },
      },
      {
        id: 'l-b',
        code: 'BDG',
        name: 'Bandung',
        permissions: { item: 'view', handover: 'none', stock: 'none' },
      },
    ],
  };
});

test('hanya menawarkan lokasi aktif yang boleh ditulis user', async () => {
  const onChange = vi.fn();
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="item" level="edit" value="" onChange={onChange} />
    </ActiveLocationsProvider>,
  );
  const select = screen.getByLabelText('Lokasi');
  const options = within(select)
    .getAllByRole('option')
    .map((o) => o.textContent);
  expect(options).toContain('Jakarta (JKT)');
  expect(options).not.toContain('Bandung (BDG)');
  await userEvent.selectOptions(select, 'Jakarta (JKT)');
  expect(onChange).toHaveBeenCalledWith('l-a');
});

test('tanpa lokasi yang boleh ditulis, field dinonaktifkan dengan keterangan', () => {
  me = {
    ...me,
    locations: me.locations.map((l) => ({ ...l, permissions: { ...l.permissions, item: 'view' } })),
  };
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="item" level="edit" value="" onChange={() => undefined} />
    </ActiveLocationsProvider>,
  );
  expect(screen.getByLabelText('Lokasi')).toBeDisabled();
  expect(screen.getByText('Tidak ada lokasi aktif yang boleh Anda ubah.')).toBeInTheDocument();
});
