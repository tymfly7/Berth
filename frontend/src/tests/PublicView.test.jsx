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
    // URL-aware mock: /api/public/metrics returns the metrics object, while
    // /api/history and /api/cameras must return arrays (the component maps over
    // them). A blanket object response would crash the render.
    global.fetch = vi.fn((url) => {
      const body = String(url).includes('/api/public/metrics') ? MOCK_METRICS : []
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
  })

  it('renders the Berth heading', () => {
    render(
      <MemoryRouter>
        <PublicView />
      </MemoryRouter>
    )
    expect(screen.getByText('Berth')).toBeTruthy()
  })

  it('displays available spot count after metrics load', async () => {
    render(
      <MemoryRouter>
        <PublicView />
      </MemoryRouter>
    )

    // '4' shows in both the hero number and the "Available" metric card.
    await waitFor(() => {
      expect(screen.getAllByText('4').length).toBeGreaterThan(0)
    })
  })
})
