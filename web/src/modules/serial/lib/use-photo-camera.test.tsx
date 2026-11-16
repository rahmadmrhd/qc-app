import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CAMERA_ERROR_TEXT } from './use-camera-scanner';
import { usePhotoCamera } from './use-photo-camera';

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

let captureFn: (() => Promise<File | null>) | null = null;

function Probe({ enabled = true }: { enabled?: boolean }) {
  const camera = usePhotoCamera({ enabled });
  captureFn = camera.capture;
  return (
    <div>
      <video ref={camera.videoRef} aria-label="pratinjau" muted />
      <p data-testid="state">
        {camera.state.status === 'error' ? `error:${camera.state.kind}` : camera.state.status}
      </p>
      <button type="button" onClick={camera.retry}>
        ulang
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
  Reflect.deleteProperty(HTMLVideoElement.prototype, 'videoWidth');
  Reflect.deleteProperty(HTMLVideoElement.prototype, 'videoHeight');
  captureFn = null;
});

test('menyalakan kamera lalu siap; unmount mematikan trek', async () => {
  const { stream, track } = fakeStream();
  const getUserMedia = vi.fn(async () => stream);
  setMediaDevices({ getUserMedia });
  const view = render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('scanning'));
  expect(getUserMedia).toHaveBeenCalledWith(
    expect.objectContaining({ audio: false, video: expect.objectContaining({}) }),
  );
  view.unmount();
  expect(track.stop).toHaveBeenCalled();
});

test('enabled false: kamera tidak diminta', async () => {
  const getUserMedia = vi.fn(async () => fakeStream().stream);
  setMediaDevices({ getUserMedia });
  render(<Probe enabled={false} />);
  await act(async () => undefined);
  expect(getUserMedia).not.toHaveBeenCalled();
});

test.each([
  ['NotAllowedError', 'denied'],
  ['NotFoundError', 'notfound'],
  ['NotReadableError', 'busy'],
] as const)('galat %s diklasifikasikan %s', async (name, kind) => {
  setMediaDevices({
    getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('x'), { name });
    }),
  });
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(`error:${kind}`));
  expect(CAMERA_ERROR_TEXT[kind]).toBeTruthy();
});

test('tanpa mediaDevices: galat unsupported tanpa meminta apa pun', async () => {
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:'));
});

test('retry mencoba lagi setelah galat', async () => {
  const { stream } = fakeStream();
  const getUserMedia = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    .mockResolvedValue(stream);
  setMediaDevices({ getUserMedia });
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:denied'));
  act(() => screen.getByRole('button', { name: 'ulang' }).click());
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('scanning'));
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});

test('capture: menggambar bingkai ke kanvas dan mengembalikan berkas JPEG', async () => {
  setMediaDevices({ getUserMedia: vi.fn(async () => fakeStream().stream) });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => 4000,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => 3000,
    configurable: true,
  });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback, type) =>
      callback(new Blob([new Uint8Array(5)], { type: type ?? 'image/jpeg' })),
    );
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('scanning'));
  const file = await captureFn?.();
  expect(file).toBeInstanceOf(File);
  expect(file?.type).toBe('image/jpeg');
  expect(file?.name).toMatch(/\.jpg$/);
  // 4000x3000 diskalakan ke sisi terpanjang 2560.
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1920);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', expect.any(Number));
});

test('capture: null selama kamera belum siap atau bingkai kosong', async () => {
  setMediaDevices({ getUserMedia: vi.fn(async () => fakeStream().stream) });
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('scanning'));
  // jsdom: videoWidth = 0
  expect(await captureFn?.()).toBeNull();
});
