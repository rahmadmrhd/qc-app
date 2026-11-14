import type { OutboxEntry } from './outbox';

/** Teks tampilan satu entri antrean untuk daftar chip: `kind` = jenis, `target` = isi singkat (butir, komentar, atau customer). */
export function describeEntry(entry: OutboxEntry): { kind: string; target: string } {
  switch (entry.kind) {
    case 'check':
      return { kind: 'Centang', target: entry.text };
    case 'comment':
      return { kind: 'Komentar', target: entry.body };
    case 'create': {
      const names = entry.tasks
        .map((task) => task.customerName.trim())
        .filter((name) => name !== '');
      const shown = names.slice(0, 2).join(', ');
      const more = names.length > 2 ? ` (+${names.length - 2})` : '';
      return {
        kind: 'Task baru',
        target: shown === '' ? `${entry.tasks.length} task` : `${shown}${more}`,
      };
    }
  }
}

/**
 * Teks yang dapat disalin dari entri yang ditolak/kedaluwarsa (isinya tak boleh hilang begitu saja): isi komentar, atau
 * catatan tiap task baru dipisah baris kosong. Centang tak punya teks untuk disalin.
 */
export function copyableText(entry: OutboxEntry): string | null {
  if (entry.kind === 'comment') return entry.body;
  if (entry.kind === 'create') return entry.tasks.map((task) => task.note).join('\n\n');
  return null;
}
