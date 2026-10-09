import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) =>
    id === 'ok'
      ? { url: 'data:image/png;base64,AAA', isLoading: false, isError: false }
      : id === 'muat'
        ? { url: null, isLoading: true, isError: false }
        : { url: null, isLoading: false, isError: true },
}));

import { MarkdownView } from './markdown-view';

test('merender Markdown umum dan tabel GFM', () => {
  render(
    <MarkdownView
      source={
        '# Judul\n\n**tebal** dan _miring_\n\n- satu\n- dua\n\n| a | b |\n|---|---|\n| 1 | 2 |'
      }
    />,
  );
  expect(screen.getByRole('heading', { name: 'Judul' })).toBeInTheDocument();
  expect(screen.getByText('tebal').tagName).toBe('STRONG');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('table')).toBeInTheDocument();
});

test('HTML mentah tidak dieksekusi: tampil sebagai teks', () => {
  const { container } = render(
    <MarkdownView source={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'} />,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

test('tautan berbahaya dibuang; tautan aman dibuka di tab baru tanpa referrer', () => {
  const { container } = render(
    <MarkdownView
      source={
        '[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](//evil.test) [d](vbscript:x) ' +
        '[ok](https://contoh.test/x) [mail](mailto:a@b.test)'
      }
    />,
  );
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['https://contoh.test/x', 'mailto:a@b.test']);
  const safe = container.querySelector('a[href="https://contoh.test/x"]');
  expect(safe).toHaveAttribute('target', '_blank');
  expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
  expect(container.textContent).toContain('a');
});

test('gambar eksternal tidak pernah dimuat; hanya qcfile: yang dirender', () => {
  const { container } = render(
    <MarkdownView
      source={
        '![jahat](https://evil.test/x.png) ![data](data:image/png;base64,AAA) ![foto](qcfile:ok)'
      }
    />,
  );
  const images = [...container.querySelectorAll('img')];
  expect(images).toHaveLength(1);
  expect(images[0]).toHaveAttribute('src', 'data:image/png;base64,AAA');
  expect(images[0]).toHaveAttribute('alt', 'foto');
});

test('status gambar qcfile: saat memuat dan saat gagal', () => {
  render(<MarkdownView source={'![a](qcfile:muat) ![b](qcfile:rusak)'} />);
  expect(screen.getByRole('img', { name: 'Memuat gambar' })).toBeInTheDocument();
  expect(screen.getByText('[gambar tidak tersedia]')).toBeInTheDocument();
});

test('rujukan qcfile: yang tidak sah tidak dirender sebagai gambar', () => {
  const { container } = render(
    <MarkdownView source={'![x](qcfile:a/b) ![y](qcfile:) ![z](QCFILE:ok)'} />,
  );
  expect(container.querySelector('img')).toBeNull();
});
