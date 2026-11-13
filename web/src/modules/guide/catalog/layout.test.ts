import type { MeDto } from '@shared/contract';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetInstallForTests, startInstallCapture } from '@/app/pwa/install';
import { offeredGuides } from '../lib/offer';
import { deriveDeviceGuides, deviceGuideRelevance, readPushSubscribed } from './device';
import { GUIDE_CATALOG } from './index';
import { DASAR_LAYOUT } from './layout';

function me(overrides: Partial<MeDto> = {}): MeDto {
  return {
    email: 'a@qc.local',
    name: 'A',
    isSuperAdmin: false,
    permissions: {} as MeDto['permissions'],
    locations: [],
    businessUnits: [],
    sharedAccount: false,
    ...overrides,
  };
}

let standalone = false;
let stopCapture: (() => void) | undefined;

function stubPush(permission: NotificationPermission | 'absent') {
  if (permission === 'absent') return;
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission });
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
}

function firePrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt: vi.fn().mockResolvedValue(undefined) });
  window.dispatchEvent(event);
}

beforeEach(() => {
  resetInstallForTests();
  standalone = false;
  window.matchMedia = vi.fn(
    (query: string) =>
      ({ matches: standalone && query === '(display-mode: standalone)' }) as MediaQueryList,
  );
  stopCapture = startInstallCapture();
});
afterEach(() => {
  stopCapture?.();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks();
});

describe('deriveDeviceGuides: perangkat-pwa', () => {
  test('true saat belum terpasang dan peramban menawarkan pemasangan', () => {
    firePrompt();
    expect(deriveDeviceGuides().get('perangkat-pwa')).toBe(true);
  });

  test('true di iOS yang belum terpasang (pemasangan manual)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    );
    expect(deriveDeviceGuides().get('perangkat-pwa')).toBe(true);
  });

  test('false saat aplikasi berjalan terpasang (standalone)', () => {
    firePrompt();
    standalone = true;
    expect(deriveDeviceGuides().get('perangkat-pwa')).toBe(false);
  });

  test('false bila perangkat tidak dapat memasang', () => {
    expect(deriveDeviceGuides().get('perangkat-pwa')).toBe(false);
  });
});

const ON = { enabled: true, publicKey: 'K', userEnabled: true } as const;

describe('deriveDeviceGuides: perangkat-push', () => {
  test('false saat izin granted dan langganan ada', () => {
    stubPush('granted');
    expect(deriveDeviceGuides({ pushSubscribed: true, pushConfig: ON }).get('perangkat-push')).toBe(
      false,
    );
  });

  test('true saat izin granted tetapi belum berlangganan', () => {
    stubPush('granted');
    expect(
      deriveDeviceGuides({ pushSubscribed: false, pushConfig: ON }).get('perangkat-push'),
    ).toBe(true);
  });

  test('langganan belum diketahui: granted dianggap beres (diam, bukan menawarkan keliru)', () => {
    stubPush('granted');
    expect(deriveDeviceGuides({ pushConfig: ON }).get('perangkat-push')).toBe(false);
  });

  test.each(['default', 'denied'] as const)('true saat izin %s', (permission) => {
    stubPush(permission);
    expect(deriveDeviceGuides({ pushSubscribed: true, pushConfig: ON }).get('perangkat-push')).toBe(
      true,
    );
  });

  // I3 (keputusan pemilik 2026-11-14): hanya bila push benar-benar bisa dipakai di perangkat ini.
  test('I3: peramban tidak mendukung push = tidak ditawarkan', () => {
    stubPush('absent');
    expect(deriveDeviceGuides({ pushConfig: ON }).get('perangkat-push')).toBe(false);
  });

  test('I3: konfigurasi belum termuat = tidak ditawarkan (aman)', () => {
    stubPush('default');
    expect(deriveDeviceGuides({}).get('perangkat-push')).toBe(false);
  });

  test('I3: server tanpa VAPID (enabled false) = tidak ditawarkan', () => {
    stubPush('default');
    expect(
      deriveDeviceGuides({ pushConfig: { ...ON, enabled: false } }).get('perangkat-push'),
    ).toBe(false);
  });

  test('I3: pengguna mematikan push (userEnabled false) = tidak ditawarkan', () => {
    stubPush('default');
    expect(
      deriveDeviceGuides({ pushConfig: { ...ON, userEnabled: false } }).get('perangkat-push'),
    ).toBe(false);
  });
});

describe('deviceGuideRelevance (menu Panduan, M12)', () => {
  test('push relevan bila tersedia (izin apa pun, termasuk granted dan sudah berlangganan)', () => {
    stubPush('granted');
    expect(deviceGuideRelevance({ pushConfig: ON }).get('perangkat-push')).toBe(true);
  });

  test('push tidak relevan: tak didukung, config belum termuat/mati, atau pengguna mematikan', () => {
    stubPush('absent');
    expect(deviceGuideRelevance({ pushConfig: ON }).get('perangkat-push')).toBe(false);
    stubPush('default');
    expect(deviceGuideRelevance({}).get('perangkat-push')).toBe(false);
    expect(
      deviceGuideRelevance({ pushConfig: { ...ON, enabled: false } }).get('perangkat-push'),
    ).toBe(false);
    expect(
      deviceGuideRelevance({ pushConfig: { ...ON, userEnabled: false } }).get('perangkat-push'),
    ).toBe(false);
  });

  test('PWA relevan hanya bila perangkat dapat memasang (sama dengan butir Pasang aplikasi)', () => {
    expect(deviceGuideRelevance({}).get('perangkat-pwa')).toBe(false);
    firePrompt();
    expect(deviceGuideRelevance({}).get('perangkat-pwa')).toBe(true);
    standalone = true;
    expect(deviceGuideRelevance({}).get('perangkat-pwa')).toBe(false);
  });

  test('yang ditawarkan selalu bagian dari yang relevan', () => {
    stubPush('default');
    const relevant = deviceGuideRelevance({ pushConfig: { ...ON, userEnabled: false } });
    const derived = deriveDeviceGuides({ pushConfig: { ...ON, userEnabled: false } });
    for (const [id, offered] of derived) if (offered) expect(relevant.get(id)).toBe(true);
  });
});

describe('readPushSubscribed', () => {
  test('true bila pushManager punya langganan, false bila tidak', async () => {
    const win = (subscription: unknown) =>
      ({
        navigator: {
          serviceWorker: {
            ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
          },
        },
      }) as unknown as Window;
    await expect(readPushSubscribed(win({}))).resolves.toBe(true);
    await expect(readPushSubscribed(win(null))).resolves.toBe(false);
  });

  test('false tanpa service worker', async () => {
    await expect(readPushSubscribed({ navigator: {} } as unknown as Window)).resolves.toBe(false);
  });
});

describe('dasar-layout', () => {
  test('berstatus disimpan, tanpa halaman dan izin', () => {
    expect(DASAR_LAYOUT).toMatchObject({ id: 'dasar-layout', kind: 'dasar', status: 'disimpan' });
    expect(DASAR_LAYOUT.halaman).toBeUndefined();
    expect(DASAR_LAYOUT.izin).toBeUndefined();
  });

  test('stepCount sama dengan jumlah langkah bagi pengguna tanpa modul apa pun', () => {
    expect(DASAR_LAYOUT.steps.every((step) => step.izin === undefined)).toBe(true);
    const offers = offeredGuides({
      me: me(),
      catalog: GUIDE_CATALOG,
      done: new Map(),
      derived: new Map(),
    });
    const layout = offers.find((offer) => offer.entry.id === 'dasar-layout');
    expect(layout?.stepCount).toBe(DASAR_LAYOUT.steps.length);
  });

  test('urutan langkah: sidebar, lokasi, lonceng, tema, menu profil', () => {
    expect(DASAR_LAYOUT.steps.map((step) => step.target)).toEqual([
      'sidebar-menu',
      'location-picker',
      'notification-bell',
      'theme-toggle',
      'user-menu',
    ]);
  });

  test('panduan perangkat hanya ditawarkan menurut keadaan perangkat', () => {
    const offer = (derived: Map<string, boolean>) =>
      offeredGuides({ me: me(), catalog: GUIDE_CATALOG, done: new Map(), derived }).map(
        (item) => item.entry.id,
      );
    expect(offer(new Map())).not.toContain('perangkat-pwa');
    expect(offer(new Map([['perangkat-pwa', true]]))).toContain('perangkat-pwa');
    expect(offer(new Map([['perangkat-push', true]]))).toContain('perangkat-push');
  });
});
