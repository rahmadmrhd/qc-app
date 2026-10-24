// Spike Task 0.2 — Worker sementara (dihapus setelah uji). URL jembatan datang dari
// query ?u=... agar tidak ada nilai tertanam. Tanpa rahasia.
function b64(n: number): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunk = a.repeat(64);
  let s = '';
  while (s.length < n) s += chunk;
  return s.slice(0, n);
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const target = url.searchParams.get('u');
    if (!target) return new Response('u?', { status: 400 });
    const bytes = Number(url.searchParams.get('bytes') ?? '10240');
    const n = Number(url.searchParams.get('n') ?? '1');
    const mode = url.searchParams.get('mode') ?? 'follow'; // follow | manual | anon
    const body = `{"action":"x","payload":"${b64(bytes)}"}`; // penyambungan string, tanpa JSON.parse
    const rows: unknown[] = [];
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      try {
        let r: Response;
        let note = '';
        if (mode === 'manual') {
          const r1 = await fetch(target, {
            method: 'POST',
            body,
            redirect: 'manual',
            headers: { 'content-type': 'text/plain' },
          });
          const loc = r1.headers.get('location');
          note = `first=${r1.status} loc=${loc ? new URL(loc).host : 'none'}`;
          r = loc ? await fetch(loc) : r1;
        } else {
          r = await fetch(target, {
            method: 'POST',
            body,
            redirect: 'follow',
            headers: { 'content-type': 'text/plain' },
          });
          note = `redirected=${r.redirected} finalHost=${new URL(r.url).host}`;
        }
        const text = await r.text();
        const dt = Date.now() - t0;
        times.push(dt);
        rows.push({
          i,
          status: r.status,
          ms: dt,
          note,
          respLen: text.length,
          resp: text.slice(0, 160),
        });
      } catch (e) {
        rows.push({ i, error: String(e), ms: Date.now() - t0 });
      }
    }
    const summary = times.length
      ? {
          n: times.length,
          p50: pct(times, 50),
          p95: pct(times, 95),
          min: Math.min(...times),
          max: Math.max(...times),
        }
      : null;
    return Response.json({ bytes, bodyLen: body.length, mode, summary, rows });
  },
};
