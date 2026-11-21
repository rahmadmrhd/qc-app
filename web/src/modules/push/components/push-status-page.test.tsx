import type { PushUserStatusDto, UserDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';

const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));

import { PushStatusPage } from './push-status-page';

const rows: PushUserStatusDto[] = [
  { email: 'budi@qc.local', name: 'Budi', state: 'active' },
  { email: 'cici@qc.local', name: 'Cici', state: 'denied' },
  { email: 'dodi@qc.local', name: 'Dodi', state: 'failing' },
  { email: 'eka@qc.local', name: 'Eka', state: 'none' },
  { email: 'fani@qc.local', name: 'Fani', state: 'disabled' },
];

const users: UserDto[] = [
  {
    id: 'u-cici',
    email: 'Cici@qc.local',
    name: 'Cici',
    status: 'active',
    assignments: [],
    buAssignments: [],
    sharedAccount: false,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [text, setText] = useState(initial);
  return <PushStatusPage text={text} onTextChange={setText} />;
}

async function mount(initial = '') {
  return renderInRouter(<Harness initial={initial} />);
}

beforeEach(() => {
  state.api.mockReset();
  state.api.mockImplementation(async (id: string) => {
    if (id === 'push.status') return rows;
    if (id === 'access.users.list') return users;
    throw new Error(`api tak terduga: ${id}`);
  });
});

test('menampilkan status per pengguna, masalah dulu, dengan label Indonesia dan ringkasan', async () => {
  await mount();
  await screen.findByText('Cici');
  expect(state.api).toHaveBeenCalledWith('push.status', null);
  const body = screen.getAllByRole('row').slice(1);
  expect(body.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
    'Cici',
    'Dodi',
    'Eka',
    'Fani',
    'Budi',
  ]);
  const cici = screen.getByText('Cici').closest('tr');
  expect(cici).toHaveTextContent('Izin ditolak');
  expect(screen.getByLabelText('Ringkasan status')).toHaveTextContent('Aktif: 1');
  expect(screen.getByLabelText('Ringkasan status')).toHaveTextContent('Izin ditolak: 1');
});

test('nama menaut ke View pengguna bila emailnya dikenal (tanpa beda huruf); selain itu teks biasa', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'Cici' })).toHaveAttribute(
    'href',
    '/access/users/u-cici',
  );
  expect(screen.queryByRole('link', { name: 'Budi' })).toBeNull();
  expect(screen.getByText('Budi')).toBeInTheDocument();
});

test('tidak menampilkan pengenal perangkat atau endpoint', async () => {
  await mount();
  await screen.findByText('Cici');
  expect(document.body.textContent).not.toMatch(/endpoint|fcm|https?:\/\//i);
});

test('pencarian menyaring nama atau email; tak cocok = pesan kosong dengan tombol hapus filter', async () => {
  await mount();
  await screen.findByText('Cici');
  await userEvent.type(screen.getByLabelText('Cari nama atau email'), 'dodi@');
  expect(screen.queryByText('Cici')).not.toBeInTheDocument();
  expect(screen.getByText('Dodi')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Cari nama atau email'));
  await userEvent.type(screen.getByLabelText('Cari nama atau email'), 'zzz');
  expect(await screen.findByText('Tidak ada hasil untuk filter ini.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus filter' })).toBeInTheDocument();
});

test('galat memuat: pesan galat dengan tombol coba lagi', async () => {
  state.api.mockImplementation(async (id: string) => {
    if (id === 'push.status') throw new Error('gagal');
    return users;
  });
  await mount();
  expect(await screen.findByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
});

let media: ReturnType<typeof mockMatchMedia>;
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul nama, badge status, meta email', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await mount('cici');
  await screen.findByRole('link', { name: 'Cici' });
  const list = screen.getByRole('list', { name: 'Status push pengguna' });
  expect(screen.queryByRole('table')).toBeNull();
  const card = within(list).getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'Cici' })).toBeInTheDocument();
  expect(within(card).getByText('Izin ditolak')).toBeInTheDocument();
  expect(within(card).getByText('cici@qc.local')).toBeInTheDocument();
});
