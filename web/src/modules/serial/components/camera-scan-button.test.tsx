import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CameraScanButton } from './camera-scan-button';
import { SerialScanInput } from './serial-scan-input';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('tombol tersembunyi bila peramban tak punya mediaDevices/getUserMedia (bukan HTTPS)', () => {
  render(<CameraScanButton onScan={() => 'added'} />);
  expect(screen.queryByRole('button', { name: 'Scan dengan kamera' })).not.toBeInTheDocument();
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  render(<CameraScanButton onScan={() => 'added'} />);
  expect(screen.queryByRole('button', { name: 'Scan dengan kamera' })).not.toBeInTheDocument();
});

test('kolom pindai menampilkan tombol kamera hanya bila getUserMedia tersedia', () => {
  const view = render(<SerialScanInput id="scan" label="Pindai serial" onSubmit={() => 'added'} />);
  expect(screen.queryByRole('button', { name: 'Scan dengan kamera' })).not.toBeInTheDocument();
  view.unmount();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  render(<SerialScanInput id="scan" label="Pindai serial" onSubmit={() => 'added'} />);
  expect(screen.getByRole('button', { name: 'Scan dengan kamera' })).toBeInTheDocument();
});

test('tombol dinonaktifkan mengikuti disabled dan membuka dialog (dimuat malas) bila diklik', async () => {
  const getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  const view = render(<CameraScanButton onScan={() => 'added'} disabled />);
  expect(screen.getByRole('button', { name: 'Scan dengan kamera' })).toBeDisabled();
  view.unmount();

  render(<CameraScanButton onScan={() => 'added'} />);
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Izin kamera ditolak');
});
