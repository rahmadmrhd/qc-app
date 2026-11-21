import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'
import { Button } from './button'

describe('Button', () => {
  it('soft destructive membawa data-variant dan data-color', () => {
    render(
      <Button variant="soft" color="destructive">
        Hapus
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Hapus' })
    expect(b).toHaveAttribute('data-color', 'destructive')
    expect(b).toHaveAttribute('data-variant', 'soft')
  })

  it('bawaan solid primary', () => {
    render(<Button>Simpan</Button>)
    const b = screen.getByRole('button', { name: 'Simpan' })
    expect(b).toHaveAttribute('data-variant', 'solid')
    expect(b).toHaveAttribute('data-color', 'primary')
  })
})

describe('Badge', () => {
  it('tidak menyisipkan titik penanda sebelum isi', () => {
    const { container } = render(<Badge color="success" variant="soft">Aktif</Badge>)
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="badge-dot"]')).toBeNull()
  })
})
