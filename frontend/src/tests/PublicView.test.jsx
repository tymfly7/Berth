import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicView from '../pages/PublicView'

const MOCK_METRICS = {
  total: 10,
  available: 4,
  occupied: 6,
  occupancy_percent: 60,
  avg_confidence: 0.8,
  slots: [],
  timestamp: '2026-01-01T00:00:00Z',
}

describe('PublicView', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_METRICS),
    })
  })

  it('renders the Parking Availability heading', () => {
    render(
      <MemoryRouter>
        <PublicView />
      </MemoryRouter>
    )
    expect(screen.getByText('Parking Availability')).toBeTruthy()
  })

  it('displays available spot count after metrics load', async () => {
    render(
      <MemoryRouter>
        <PublicView />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('4')).toBeTruthy()
    })
  })
})
