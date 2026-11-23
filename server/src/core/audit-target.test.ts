// Tautan Log Audit ke entitasnya (redesain fase 4c, keputusan pemilik 2026-11-20): `audit_log.target_id` diisi penulis
// audit model ber-View, `access.audit.list` menurunkan `targetRef` dari awalan aksi, dan entri lama (tanpa `target_id`)
// tetap teks biasa. Pemindai di bawah menjaga SEMUA penulis audit entitas membawa `targetId` (mencegah tautan hilang
// diam-diam saat penulis baru ditambahkan).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listAuditPage } from '@server/modules/access/service';
import { createTestEnv } from '@server-test/test-env';
import { AUDIT_NON_ENTITY_ACTIONS, auditTargetKind } from '@shared/audit';
import { writeAudit } from './audit';

const ROOT = join(import.meta.dir, '..');

/** Semua berkas sumber server (bukan tes, bukan test-support); `audit.ts` sendiri memetakan baris, bukan menulis entri. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Posisi kurung kurawal pembuka objek yang melingkupi `pos` (mundur, menyeimbangkan `}`/`{`). */
function openBrace(text: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Posisi kurung kurawal penutup yang menyeimbangkan `open`. */
function closeBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface AuditLiteral {
  file: string;
  line: number;
  body: string;
  actions: string[];
}

/** Objek literal berbentuk `AuditInput` (memuat `actor:`, `action` dan `target:`) beserta aksi literalnya. */
function auditLiterals(): AuditLiteral[] {
  const found: AuditLiteral[] = [];
  for (const path of sourceFiles(ROOT)) {
    const file = relative(join(ROOT, '..', '..'), path).replaceAll('\\', '/');
    if (file === 'server/src/core/audit.ts' || file.includes('/test-support/')) continue;
    const text = readFileSync(path, 'utf8');
    const seen = new Set<number>();
    for (const match of text.matchAll(/^[ \t]*action(?::|,)/gm)) {
      const open = openBrace(text, match.index ?? 0);
      if (open < 0 || seen.has(open)) continue;
      const close = closeBrace(text, open);
      const body = text.slice(open, close + 1);
      if (!/\bactor:/.test(body) || !/\btarget:/.test(body)) continue;
      seen.add(open);
      const exprStart = (match.index ?? 0) - open;
      const rest = body.slice(exprStart);
      // Ungkapan `action:` berakhir pada koma tingkat atas berikutnya (ternary memuat beberapa literal).
      let end = rest.length;
      let depth = 0;
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (ch === ',' && depth === 0) {
          end = i;
          break;
        }
      }
      const expr = rest.slice(0, end);
      const actions = [...expr.matchAll(/'([A-Za-z]+\.[A-Za-z_]+)'/g)].map((m) => m[1] as string);
      found.push({
        file,
        line: text.slice(0, open).split('\n').length,
        body,
        actions,
      });
    }
  }
  return found;
}

describe('auditTargetKind', () => {
  test('memetakan awalan aksi ke jenis entitas', () => {
    expect(auditTargetKind('brand.update')).toBe('brand');
    expect(auditTargetKind('businessunit.create')).toBe('businessUnit');
    expect(auditTargetKind('qrcode.create')).toBe('qrDesign');
    expect(auditTargetKind('qrcode.preset_update')).toBe('qrPreset');
    expect(auditTargetKind('stickerType.status')).toBe('stickerType');
    expect(auditTargetKind('serial.proof_remove')).toBe('serial');
    expect(auditTargetKind('user.delete')).toBe('user');
    expect(auditTargetKind('customer.restore')).toBe('customer');
  });

  test('aksi tautan dashboard dipetakan per aksi, bukan per awalan `dashboard`', () => {
    expect(auditTargetKind('dashboard.share_create')).toBe('dashboardShare');
    expect(auditTargetKind('dashboard.share_revoke')).toBe('dashboardShare');
    // Aksi lain berawalan `dashboard.` (mis. laporan terjadwal) tidak otomatis menjadi tautan.
    expect(auditTargetKind('dashboard.report_create')).toBeUndefined();
    expect(auditTargetKind('dashboard.report_run')).toBeUndefined();
  });

  test('aksi tanpa entitas ber-View tidak punya jenis', () => {
    for (const action of AUDIT_NON_ENTITY_ACTIONS) expect(auditTargetKind(action)).toBeUndefined();
    expect(auditTargetKind('export.sheets')).toBeUndefined();
    expect(auditTargetKind('stickerGuide.remove')).toBeUndefined();
    expect(auditTargetKind('tidakada')).toBeUndefined();
  });
});

describe('penulis audit entitas membawa targetId', () => {
  const literals = auditLiterals();

  test('pemindai menemukan penulis audit (bukan pemindaian kosong)', () => {
    expect(literals.length).toBeGreaterThan(30);
  });

  test('setiap penulis audit berawalan entitas ber-View memuat targetId', () => {
    const missing = literals
      .filter((entry) =>
        entry.actions.length === 0
          ? true // `action` dari variabel: wajib membawa targetId
          : entry.actions.some((action) => auditTargetKind(action) !== undefined),
      )
      .filter((entry) => !/\btargetId:/.test(entry.body))
      .map((entry) => `${entry.file}:${entry.line} (${entry.actions.join(' | ') || 'variabel'})`);
    expect(missing).toEqual([]);
  });
});

describe('writeAudit dan access.audit.list', () => {
  test('writeAudit menyimpan targetId; entri tanpa targetId tersimpan kosong', async () => {
    const env = await createTestEnv();
    await env.DB.batch([
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:00.000Z',
        actor: 'a@gmail.com',
        action: 'brand.update',
        target: 'Sony',
        targetId: 'brand-1',
      }),
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:01.000Z',
        actor: 'a@gmail.com',
        action: 'brand.update',
        target: 'Lama',
      }),
    ]);
    const rows = await env.DB.prepare('SELECT target, target_id FROM audit_log ORDER BY id').all<{
      target: string;
      target_id: string;
    }>();
    expect(rows.results).toEqual([
      { target: 'Sony', target_id: 'brand-1' },
      { target: 'Lama', target_id: '' },
    ]);
  });

  test('targetRef hanya untuk entri ber-target_id dan beraksi entitas; entri lama tetap teks', async () => {
    const env = await createTestEnv();
    await env.DB.batch([
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:00.000Z',
        actor: 'a@gmail.com',
        action: 'brand.update',
        target: 'Sony',
        targetId: 'brand-1',
      }),
      // entri lama (sebelum fase ini): tanpa target_id
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:01.000Z',
        actor: 'a@gmail.com',
        action: 'brand.update',
        target: 'Lama',
      }),
      // aksi tanpa entitas ber-View walau (salah) membawa targetId: tidak menaut
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:02.000Z',
        actor: 'a@gmail.com',
        action: 'sticker.settings',
        target: 'Konfigurasi Stiker',
        targetId: 'x',
      }),
      writeAudit(env.DB, {
        ts: '2026-11-20T00:00:03.000Z',
        actor: 'a@gmail.com',
        action: 'businessunit.delete',
        target: 'BU1',
        targetId: 'bu-1',
      }),
    ]);
    const page = await listAuditPage(env, { limit: 10 });
    const byTarget = new Map(page.entries.map((entry) => [entry.target, entry]));
    expect(byTarget.get('Sony')?.targetRef).toEqual({ kind: 'brand', id: 'brand-1' });
    expect(byTarget.get('Lama')?.targetRef).toBeUndefined();
    expect(byTarget.get('Konfigurasi Stiker')?.targetRef).toBeUndefined();
    expect(byTarget.get('BU1')?.targetRef).toEqual({ kind: 'businessUnit', id: 'bu-1' });
  });
});
