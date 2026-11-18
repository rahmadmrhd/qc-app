// Migrasi data aplikasi QC lama (dump mysqldump `qcspectrum`) ke database QC saat ini.
//
//   bun run --cwd server scripts/migrate-legacy-qc.ts --dump <berkas.sql> [opsi]
//
// BAWAAN = DRY-RUN: hanya membaca tujuan (SELECT) dan menulis laporan; tidak menulis ke database.
//   --apply                      tulis ke database (wajib bersama --confirm-database)
//   --confirm-database <nama>    harus sama dengan nama skema pada DATABASE_URL (pengaman salah sasaran)
//   --item-bu brand|brand+serials  BU item: bawaan merk saja, atau + BU tempat serialnya tercatat (bawaan)
//   --report-dir <folder>        folder laporan (bawaan ./legacy-qc-report)
//   --offline                    tanpa koneksi database: hanya rencana dan CSV (pencocokan tujuan dilewati)
// Pemetaan dan keputusan: docs/superpowers/specs/2026-11-17-migrasi-data-qc-lama-pemetaan.md.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from '@server/core/db';
import { applyPlan, loadTargetState, type Resolved, resolvePlan } from './legacy-qc/apply';
import { readDump } from './legacy-qc/dump';
import { buildPlan, type ItemBuMode, type Plan } from './legacy-qc/plan';

interface Args {
  dump: string;
  apply: boolean;
  confirmDatabase: string;
  itemBu: ItemBuMode;
  reportDir: string;
  offline: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    dump: '',
    apply: false,
    confirmDatabase: '',
    itemBu: 'brand+serials',
    reportDir: './legacy-qc-report',
    offline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} butuh nilai`);
      return next;
    };
    if (flag === '--dump') args.dump = value();
    else if (flag === '--apply') args.apply = true;
    else if (flag === '--confirm-database') args.confirmDatabase = value();
    else if (flag === '--item-bu') {
      const mode = value();
      if (mode !== 'brand' && mode !== 'brand+serials')
        throw new Error('--item-bu harus brand atau brand+serials');
      args.itemBu = mode;
    } else if (flag === '--report-dir') args.reportDir = value();
    else if (flag === '--offline') args.offline = true;
    else throw new Error(`Argumen tak dikenal: ${flag}`);
  }
  if (args.dump === '') throw new Error('--dump <berkas.sql> wajib');
  if (args.apply && args.offline) throw new Error('--apply tidak dapat dipakai bersama --offline');
  return args;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(header: string[], rows: unknown[][]): string {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

async function writeReports(dir: string, plan: Plan, resolved: Resolved | null): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(
    resolve(dir, 'dilewati.csv'),
    csv(
      ['id_lama', 'serial', 'alasan', 'rincian'],
      plan.skipped.map((row) => [row.legacyId, row.serial, row.reason, row.detail]),
    ),
  );
  await Bun.write(
    resolve(dir, 'dilipat.csv'),
    csv(
      ['serial', 'bu', 'id_menang', 'tipe_menang', 'id_dilipat', 'tipe_dilipat'],
      plan.folded.map((row) => [
        row.serial,
        row.buName,
        row.winnerLegacyId,
        row.winnerItem,
        row.loserLegacyId,
        row.loserItem,
      ]),
    ),
  );
  if (resolved) {
    await Bun.write(
      resolve(dir, 'item.csv'),
      csv(
        ['id_lama', 'merk', 'tipe', 'aksi', 'id_item_tujuan', 'bu', 'firmware', 'aksi_firmware'],
        resolved.itemResolutions.map((row) => [
          row.legacyId,
          row.brand,
          row.model,
          row.action,
          row.itemId,
          row.buNames.join('+'),
          row.firmware,
          row.firmwareAction,
        ]),
      ),
    );
    await Bun.write(
      resolve(dir, 'bentrok-tujuan.csv'),
      csv(
        ['id_lama', 'serial', 'bu', 'alasan'],
        resolved.conflicts.map((row) => [row.legacyId, row.serial, row.buName, row.reason]),
      ),
    );
  }
}

function count<T>(rows: T[], key: (row: T) => string): string {
  const tally = new Map<string, number>();
  for (const row of rows) tally.set(key(row), (tally.get(key(row)) ?? 0) + 1);
  return [...tally.entries()].map(([name, n]) => `${name}=${n}`).join(', ') || '-';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();
  console.log(`Membaca dump ${args.dump} ...`);
  const plan = buildPlan(await readDump(args.dump), { itemBu: args.itemBu, now });
  console.log(
    `Rencana: ${plan.serials.length} serial, ${plan.items.length} item, ${plan.brands.length} merk, BU ${plan.buNames.join('/')}`,
  );
  console.log(
    `  dilewati: ${count(plan.skipped, (row) => row.reason)}; dilipat: ${plan.folded.length}`,
  );
  for (const warning of plan.warnings) console.log(`  peringatan: ${warning}`);

  let resolved: Resolved | null = null;
  const url = process.env.DATABASE_URL ?? '';
  const databaseName = url === '' ? '' : new URL(url).pathname.replace(/^\//, '') || '';
  if (!args.offline) {
    if (url === '')
      throw new Error('DATABASE_URL tidak diset (gunakan --offline untuk hanya melihat rencana)');
    console.log(`Tujuan: ${new URL(url).host}/${databaseName} (hanya dibaca bila dry-run)`);
    const db = createDb({ url, connectionLimit: 2 });
    try {
      resolved = resolvePlan(plan, await loadTargetState(db));
      console.log('Pencocokan tujuan:');
      console.log(
        `  BU dibuat: ${resolved.createBus.map((bu) => bu.name).join(', ') || '-'}; lokasi dibuat: ${resolved.createLocations.map((l) => l.name).join(', ') || '-'}`,
      );
      console.log(
        `  merk dibuat: ${resolved.createBrands.length}; item: ${count(resolved.itemResolutions, (row) => row.action)}; tautan item-BU baru: ${resolved.itemBuLinks.length}`,
      );
      console.log(
        `  firmware: ${count(
          resolved.itemResolutions.filter((row) => row.firmwareAction !== 'none'),
          (row) => row.firmwareAction,
        )} (new = ikut item baru, fill = mengisi item tujuan yang kosong, keep = tujuan sudah berisi, skip = item tujuan bukan Country Lock)`,
      );
      console.log(
        `  serial ditulis: ${resolved.serials.length}; sudah dimigrasi: ${resolved.alreadyMigrated}; bentrok dengan tujuan: ${resolved.conflicts.length}`,
      );
      for (const blocker of resolved.blockers) console.log(`  HAMBATAN: ${blocker}`);
      await writeReports(resolve(args.reportDir), plan, resolved);
      console.log(`Laporan CSV: ${resolve(args.reportDir)}`);

      if (!args.apply) {
        console.log(
          '\nDRY-RUN selesai: tidak ada yang ditulis. Tambahkan --apply --confirm-database <nama> untuk menulis.',
        );
        return;
      }
      if (args.confirmDatabase !== databaseName) {
        throw new Error(
          `--confirm-database "${args.confirmDatabase}" tidak sama dengan skema tujuan "${databaseName}"; dibatalkan`,
        );
      }
      console.log('\nMenulis ke tujuan ...');
      const startedAt = Date.now();
      const result = await applyPlan(db, resolved, now, (done, total) => {
        if (done === total || done % 3000 < 150)
          console.log(
            `  serial ${done}/${total} (${Math.round((Date.now() - startedAt) / 1000)} dtk)`,
          );
      });
      console.log('Selesai:', JSON.stringify(result));
    } finally {
      await db.close();
    }
  } else {
    await writeReports(resolve(args.reportDir), plan, null);
    console.log(`Mode offline: laporan dilewati/dilipat ditulis ke ${resolve(args.reportDir)}.`);
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
