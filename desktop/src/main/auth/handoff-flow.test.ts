import { describe, expect, test } from 'vitest';
import { createHandoffFlow, HANDOFF_MESSAGES, type HandoffChoice } from './handoff-flow';
import { createTokenStore, type TokenStore } from './token-store';

const SERVER = 'https://qc.test';
const TICKET = `${'a'.repeat(40)}.${'B'.repeat(43)}`;

function setup(options: {
  signedInAs?: string;
  response?: () => Response | Promise<Response>;
  choice?: HandoffChoice;
  busy?: () => boolean;
}) {
  const tokens: TokenStore = createTokenStore('unused', null, () => 1_000);
  if (options.signedInAs) {
    tokens.set({ token: 'tok-lama', email: options.signedInAs, expiresAt: 10_000_000 });
  }
  const events: string[] = [];
  const requests: { url: string; body: string; headers: Record<string, string> }[] = [];
  const flow = createHandoffFlow({
    settings: () => ({ packageDir: null, serverUrl: SERVER }),
    tokens,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: String(init?.body),
        headers: init?.headers as Record<string, string>,
      });
      if (!options.response) throw new Error('tanpa respons');
      return options.response();
    }) as typeof fetch,
    confirmSwitch: async (current, next) => {
      events.push(`confirm:${current}->${next}`);
      return options.choice ?? 'keep';
    },
    showError: (message) => events.push(`error:${message}`),
    isBusy: options.busy ?? (() => false),
    onChange: (status) => events.push(`change:${status.signedIn}:${status.email}`),
    openCountryLock: () => events.push('open'),
  });
  return { flow, tokens, events, requests };
}

const ok = (email: string) => () =>
  new Response(JSON.stringify({ token: `tok-${email}`, expiresAt: 9_000_000, email }), {
    status: 200,
  });

describe('createHandoffFlow', () => {
  test('belum masuk: token langsung disimpan tanpa konfirmasi, lalu membuka Country Lock', async () => {
    const { flow, tokens, events, requests } = setup({ response: ok('rina@qc.local') });
    await flow.handle({ ticket: TICKET, hint: 'rina@qc.local' });
    expect(tokens.get()?.email).toBe('rina@qc.local');
    expect(events).toEqual(['change:true:rina@qc.local', 'open']);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${SERVER}/auth/desktop/handoff`);
    expect(requests[0]?.body).toBe(JSON.stringify({ ticket: TICKET }));
    expect(requests[0]?.headers['X-Requested-With']).toBe('qc');
  });

  test('petunjuk sama dengan akun saat ini: tak menukar tiket, hanya membuka Country Lock', async () => {
    const { flow, tokens, events, requests } = setup({ signedInAs: 'Rina@QC.local' });
    await flow.handle({ ticket: TICKET, hint: 'rina@qc.local' });
    expect(requests).toHaveLength(0);
    expect(tokens.get()?.token).toBe('tok-lama');
    expect(events).toEqual(['open']);
  });

  test('akun hasil tukar sama dengan akun saat ini (tanpa petunjuk): token lama tetap', async () => {
    const { flow, tokens, events } = setup({
      signedInAs: 'rina@qc.local',
      response: ok('rina@qc.local'),
    });
    await flow.handle({ ticket: TICKET, hint: null });
    expect(tokens.get()?.token).toBe('tok-lama');
    expect(events).toEqual(['open']);
  });

  test('akun berbeda, pilih lanjut: dialog menampilkan akun dari server, token diganti', async () => {
    const { flow, tokens, events } = setup({
      signedInAs: 'lama@qc.local',
      response: ok('baru@qc.local'),
      choice: 'switch',
    });
    // Petunjuk palsu tidak mengubah apa yang ditampilkan: yang dipakai hasil tukar server.
    await flow.handle({ ticket: TICKET, hint: 'orang-lain@qc.local' });
    expect(events).toEqual([
      'confirm:lama@qc.local->baru@qc.local',
      'change:true:baru@qc.local',
      'open',
    ]);
    expect(tokens.get()?.token).toBe('tok-baru@qc.local');
  });

  test('akun berbeda, pilih tetap: token lama utuh dan tidak ada perubahan status', async () => {
    const { flow, tokens, events } = setup({
      signedInAs: 'lama@qc.local',
      response: ok('baru@qc.local'),
      choice: 'keep',
    });
    await flow.handle({ ticket: TICKET, hint: 'baru@qc.local' });
    expect(events).toEqual(['confirm:lama@qc.local->baru@qc.local', 'open']);
    expect(tokens.get()?.token).toBe('tok-lama');
  });

  test('tiket ditolak server: pesan kedaluwarsa, tidak masuk, tidak membuka halaman', async () => {
    const { flow, tokens, events } = setup({
      response: () => new Response('{}', { status: 401 }),
    });
    await flow.handle({ ticket: TICKET, hint: null });
    expect(events).toEqual([`error:${HANDOFF_MESSAGES.expired}`]);
    expect(tokens.get()).toBeNull();
  });

  test('server tak terjangkau atau 5xx: pesan koneksi', async () => {
    for (const response of [
      () => {
        throw new Error('jaringan');
      },
      () => new Response('x', { status: 503 }),
    ]) {
      const { flow, events } = setup({ response });
      await flow.handle({ ticket: TICKET, hint: null });
      expect(events).toEqual([`error:${HANDOFF_MESSAGES.unreachable}`]);
    }
  });

  test('jawaban 200 yang rusak (token kosong/terlalu panjang, tanpa email) ditolak', async () => {
    for (const body of [
      {},
      { token: '', expiresAt: 1, email: 'a@b.co' },
      { token: 'x'.repeat(5000), expiresAt: 1, email: 'a@b.co' },
      { token: 't', expiresAt: 'besok', email: 'a@b.co' },
      { token: 't', expiresAt: 1, email: '' },
    ]) {
      const { flow, tokens, events } = setup({
        response: () => new Response(JSON.stringify(body), { status: 200 }),
      });
      await flow.handle({ ticket: TICKET, hint: null });
      expect(events, JSON.stringify(body)).toEqual([`error:${HANDOFF_MESSAGES.expired}`]);
      expect(tokens.get()).toBeNull();
    }
  });

  test('inject berjalan: ditolak sebelum menukar tiket, dan juga bila mulai di tengah penukaran', async () => {
    const before = setup({ busy: () => true, response: ok('a@b.co') });
    await before.flow.handle({ ticket: TICKET, hint: null });
    expect(before.events).toEqual([`error:${HANDOFF_MESSAGES.busy}`]);
    expect(before.requests).toHaveLength(0);

    let calls = 0;
    const during = setup({
      busy: () => ++calls > 1,
      response: ok('baru@qc.local'),
      signedInAs: 'lama@qc.local',
      choice: 'switch',
    });
    await during.flow.handle({ ticket: TICKET, hint: null });
    expect(during.events).toEqual([`error:${HANDOFF_MESSAGES.busy}`]);
    expect(during.tokens.get()?.token).toBe('tok-lama');
  });

  test('tautan ganda serentak: yang kedua diabaikan', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { flow, requests, events } = setup({
      response: async () => {
        await gate;
        return ok('rina@qc.local')();
      },
    });
    const first = flow.handle({ ticket: TICKET, hint: null });
    await flow.handle({ ticket: TICKET, hint: null });
    release?.();
    await first;
    expect(requests).toHaveLength(1);
    expect(events).toEqual(['change:true:rina@qc.local', 'open']);
  });
});
