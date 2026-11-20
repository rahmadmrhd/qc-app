import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CAMERA_ERROR_TEXT, type CameraStream, useCameraStream } from './use-camera-stream';

function fakeStream(caps: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => caps,
    getSettings: () => ({ deviceId: 'cam-1', ...settings }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

let latest: CameraStream;

function Harness({ open = true, deviceId = '' }: { open?: boolean; deviceId?: string }) {
  const camera = useCameraStream({ open, deviceId });
  latest = camera;
  return (
    <div>
      {/* biome-ignore lint/a11y/useMediaCaption: video palsu untuk tes */}
      <video ref={camera.videoRef} aria-label="video" />
      <p data-testid="status">
        {camera.state.status === 'error' ? `error:${camera.state.kind}` : camera.state.status}
      </p>
      <button type="button" onClick={camera.retry}>
        retry
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(document, 'hidden');
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('membuka aliran tanpa mesin: status menjadi scanning setelah video siap dan terpasang ke elemen video', async () => {
  const media = fakeStream();
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  render(<Harness />);
  expect(screen.getByTestId('status')).toHaveTextContent('loading');
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  expect((screen.getByLabelText('video') as HTMLVideoElement).srcObject).toBe(media.stream);
});

test('menutup (open:false) menghentikan semua track', async () => {
  const media = fakeStream();
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  expect(media.track.stop).not.toHaveBeenCalled();
  view.rerender(<Harness open={false} />);
  expect(media.track.stop).toHaveBeenCalledTimes(1);
});

test('tab tersembunyi menjeda (track dilepas) dan tab terlihat menyalakan lagi', async () => {
  const first = fakeStream();
  const second = fakeStream();
  const getUserMedia = vi
    .fn()
    .mockResolvedValueOnce(first.stream)
    .mockResolvedValueOnce(second.stream);
  setMediaDevices({ getUserMedia, enumerateDevices: vi.fn(async () => []) });
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  setHidden(true);
  expect(first.track.stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  setHidden(false);
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
});

test('senter dan zoom mengikuti kemampuan track; zoom diterapkan ke track', async () => {
  const media = fakeStream({ torch: true, zoom: { min: 1, max: 4, step: 0.1 } });
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  expect(latest.torchSupported).toBe(true);
  expect(latest.zoomRange).toEqual({ min: 1, max: 4, step: 0.1 });
  expect(latest.zoom).toBe(1);
  await act(async () => {
    await latest.setZoom(2);
  });
  expect(latest.zoom).toBe(2);
  expect(media.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
  await act(async () => {
    await latest.setTorch(true);
  });
  expect(latest.torchOn).toBe(true);
});

test('tanpa kemampuan senter dan zoom keduanya tidak tersedia', async () => {
  const media = fakeStream();
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  expect(latest.torchSupported).toBe(false);
  expect(latest.zoomRange).toBeNull();
});

test('reportError("loader") menjadikan state galat, mematikan track, dan retry memulai lagi', async () => {
  const first = fakeStream();
  const second = fakeStream();
  const getUserMedia = vi
    .fn()
    .mockResolvedValueOnce(first.stream)
    .mockResolvedValueOnce(second.stream);
  setMediaDevices({ getUserMedia, enumerateDevices: vi.fn(async () => []) });
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
  act(() => latest.reportError('loader'));
  expect(screen.getByTestId('status')).toHaveTextContent('error:loader');
  expect(first.track.stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(CAMERA_ERROR_TEXT.loader).toContain('Fitur scan gagal dimuat');

  await userEvent.click(screen.getByRole('button', { name: 'retry' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('scanning'));
});

test('izin ditolak: galat denied; tanpa getUserMedia: galat unsupported', async () => {
  setMediaDevices({
    getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    }),
  });
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error:denied'));
  view.unmount();

  setMediaDevices({});
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error:unsupported'));
});
