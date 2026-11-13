import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PresetDeviationBanner } from './preset-deviation-banner';

test('tanpa penyimpangan: tidak tampil apa pun', () => {
  const { container } = render(<PresetDeviationBanner presetName="Standar" deviations={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('menyebut preset dan bagian yang menyimpang dengan label Indonesia; bukan peringatan yang memblokir', () => {
  render(
    <PresetDeviationBanner
      presetName="Standar"
      deviations={['footer', 'logo', 'layout', 'style']}
    />,
  );
  const note = screen.getByRole('status');
  expect(note).toHaveTextContent('Standar');
  expect(note).toHaveTextContent('Footer, Logo, Ukuran, Gaya');
  expect(note).toHaveTextContent(/tetap dapat disimpan/i);
});
