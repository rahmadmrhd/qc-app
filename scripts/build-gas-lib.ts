export const PUBLIC_GAS_FUNCTIONS: ReadonlySet<string> = new Set(['doGet', 'api', 'setup']);

export class GasBuildError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'GasBuildError';
  }
}

export interface TransformOptions {
  /** true untuk gas/src: fungsi global wajib berakhiran `_` kecuali PUBLIC_GAS_FUNCTIONS. */
  enforcePrivateNames: boolean;
}

export interface TransformResult {
  code: string;
  globals: string[];
}

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' });

const IMPORT_STATEMENT = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"][ \t]*;?[ \t]*$/gm;
const LOCAL_EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}[ \t]*;?[ \t]*$/gm;
const EXPORT_KEYWORD =
  /^([ \t]*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;
const TOP_LEVEL_FUNCTION = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const TOP_LEVEL_BINDING = /^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_VALUE =
  /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

function assertSupportedSyntax(js: string, file: string): void {
  if (/^[ \t]*export\s+default\b/m.test(js)) {
    throw new GasBuildError(file, '`export default` tidak didukung di GAS');
  }
  if (/^[ \t]*export\s*(?:\*|\{[^}]*\})\s*from\b/m.test(js)) {
    throw new GasBuildError(file, 're-export dari modul lain tidak didukung di GAS');
  }
  if (/\bimport\s*\(/.test(js)) {
    throw new GasBuildError(file, 'dynamic import tidak didukung di GAS');
  }
  for (const statement of js.match(IMPORT_STATEMENT) ?? []) {
    const text = statement.trim();
    if (/\*\s*as\b/.test(text)) {
      throw new GasBuildError(file, `namespace import tidak didukung: ${text}`);
    }
    if (/\{[^}]*\bas\b[^}]*\}/.test(text)) {
      throw new GasBuildError(file, `import alias tidak didukung: ${text}`);
    }
    if (/^import\s+[A-Za-z_$][\w$]*\s*(?:,|from)/.test(text)) {
      throw new GasBuildError(file, `default import tidak didukung: ${text}`);
    }
  }
  for (const match of js.matchAll(LOCAL_EXPORT_LIST)) {
    if (/\bas\b/.test(match[1] ?? '')) {
      throw new GasBuildError(file, `export alias tidak didukung: ${match[0].trim()}`);
    }
  }
}

export function transformForGas(
  source: string,
  file: string,
  options: TransformOptions,
): TransformResult {
  const js = transpiler.transformSync(source);
  assertSupportedSyntax(js, file);

  const code = `${js
    .replace(IMPORT_STATEMENT, '')
    .replace(LOCAL_EXPORT_LIST, '')
    .replace(EXPORT_KEYWORD, '$1')
    .trim()}\n`;

  const globals: string[] = [];
  for (const line of code.split('\n')) {
    const fn = TOP_LEVEL_FUNCTION.exec(line);
    const binding = fn ? null : TOP_LEVEL_BINDING.exec(line);
    const name = fn?.[1] ?? binding?.[1];
    if (!name) continue;
    globals.push(name);
    if (!options.enforcePrivateNames || name.endsWith('_') || PUBLIC_GAS_FUNCTIONS.has(name)) {
      continue;
    }
    const isCallable = Boolean(fn) || FUNCTION_VALUE.test(line) || line.startsWith('class ');
    if (isCallable) {
      throw new GasBuildError(
        file,
        `fungsi global "${name}" wajib berakhiran "_" agar tidak bisa dipanggil lewat google.script.run`,
      );
    }
  }
  return { code, globals };
}

export function findDuplicateGlobals(
  files: ReadonlyArray<{ file: string; globals: readonly string[] }>,
): string[] {
  const owners = new Map<string, string[]>();
  for (const { file, globals } of files) {
    for (const name of globals) owners.set(name, [...(owners.get(name) ?? []), file]);
  }
  return [...owners]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => `"${name}" dideklarasikan di ${list.join(', ')}`);
}
