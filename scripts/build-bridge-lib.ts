import path from 'node:path';
import vm from 'node:vm';
import { findDuplicateGlobals, transformForGas } from './build-gas-lib';
import { BRIDGE_DIR, ROOT_DIR } from './paths';

export interface BridgeBuildFile {
  /** Nama berkas keluaran relatif terhadap `bridge/dist`. */
  output: string;
  code: string;
}

/**
 * Men-transpile `bridge/src` dengan pagar yang sama seperti `gas/src` (satu global scope, akhiran `_`,
 * API terlarang). Tidak menulis apa pun; melempar `GasBuildError` bila ada pelanggaran.
 */
export async function buildBridgeFiles(
  srcDir: string = path.join(BRIDGE_DIR, 'src'),
): Promise<BridgeBuildFile[]> {
  const results: Array<BridgeBuildFile & { file: string; globals: string[] }> = [];
  for await (const relative of new Bun.Glob('**/*.ts').scan({ cwd: srcDir })) {
    const normalized = relative.split(path.sep).join('/');
    if (normalized.endsWith('.test.ts') || normalized.endsWith('.d.ts')) continue;
    const absolute = path.join(srcDir, relative);
    const file = path.relative(ROOT_DIR, absolute).split(path.sep).join('/');
    const transformed = transformForGas(await Bun.file(absolute).text(), file, {
      enforcePrivateNames: true,
    });
    results.push({
      output: normalized.replace(/\.ts$/, '.js'),
      code: transformed.code,
      file,
      globals: transformed.globals,
    });
  }
  results.sort((a, b) => a.output.localeCompare(b.output));
  const duplicates = findDuplicateGlobals(results);
  if (duplicates.length > 0) {
    throw new Error(`build:bridge gagal — nama global bentrok:\n- ${duplicates.join('\n- ')}`);
  }
  return results.map(({ output, code }) => ({ output, code }));
}

/** Memuat semua berkas seperti GAS (satu global scope) maju dan mundur; mengembalikan daftar masalah. */
export function loadBridgeFiles(files: readonly BridgeBuildFile[]): string[] {
  const problems: string[] = [];
  for (const [label, order] of [
    ['maju', files],
    ['mundur', [...files].reverse()],
  ] as const) {
    const context = vm.createContext({});
    for (const file of order) {
      try {
        vm.runInContext(file.code, context, { filename: file.output });
      } catch (error) {
        problems.push(
          `${file.output} gagal dimuat (urutan ${label}): ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }
  }
  return problems;
}

/** Fungsi global publik yang diharapkan ada setelah build (pintu masuk web app). */
export function missingBridgeEntryPoints(files: readonly BridgeBuildFile[]): string[] {
  const context = vm.createContext({});
  for (const file of files) vm.runInContext(file.code, context, { filename: file.output });
  return ['doPost', 'doGet', 'setup'].filter(
    (name) => typeof (context as Record<string, unknown>)[name] !== 'function',
  );
}
