import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PageContainer, PageContent, usePageWidth } from './page-container';

function Width() {
  return <span data-testid="width">{usePageWidth()}</span>;
}

test('PageContainer selalu selebar <main>: tanpa mx-auto dan tanpa batas lebar', () => {
  render(
    <PageContainer width="narrow">
      <p>isi</p>
    </PageContainer>,
  );
  const container = screen.getByText('isi').parentElement as HTMLElement;
  expect(container.className).toContain('w-full');
  expect(container.className).not.toContain('mx-auto');
  expect(container.className).not.toMatch(/max-w-/);
});

test('PageContainer meneruskan lebar lewat konteks; bawaan default di luarnya', () => {
  const { unmount } = render(<Width />);
  expect(screen.getByTestId('width')).toHaveTextContent('default');
  unmount();
  render(
    <PageContainer width="full">
      <Width />
    </PageContainer>,
  );
  expect(screen.getByTestId('width')).toHaveTextContent('full');
});

test('PageContent memusatkan konten dengan batas menurut jenis halaman', () => {
  const widths = { narrow: 'max-w-4xl', default: 'max-w-7xl', full: 'max-w-none' } as const;
  for (const [width, limit] of Object.entries(widths)) {
    const { unmount } = render(
      <PageContainer width={width as keyof typeof widths}>
        <PageContent>
          <p>isi {width}</p>
        </PageContent>
      </PageContainer>,
    );
    const content = screen.getByText(`isi ${width}`).parentElement as HTMLElement;
    expect(content.className).toContain('mx-auto');
    expect(content.className).toContain(limit);
    unmount();
  }
});
