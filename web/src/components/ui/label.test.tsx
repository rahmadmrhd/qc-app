import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Label } from './label'

it('required memberi data-required tanpa mengubah teks label', () => {
  render(<Label required>Merk</Label>)
  const label = screen.getByText('Merk')
  expect(label).toHaveAttribute('data-required')
  expect(label.textContent).toBe('Merk')
})

it('tanpa required tidak bertanda', () => {
  render(<Label>Merk</Label>)
  expect(screen.getByText('Merk')).not.toHaveAttribute('data-required')
})

it('bintang CSS punya teks alternatif kosong agar tak masuk nama aksesibel', () => {
  render(<Label required>Merk</Label>)
  expect(screen.getByText('Merk').className).toContain("after:content-['*'_/_'']")
})
