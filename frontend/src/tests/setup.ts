import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom does not implement the canvas 2D API. Components that draw on mount
// (AnalyticsChart, RoiEditor) call getContext('2d') and would crash with a
// null context. Stub a no-op 2D context so those components render in tests.
const gradientStub = { addColorStop: () => {} }
const contextStub = new Proxy(
  {
    createLinearGradient: () => gradientStub,
    measureText: () => ({ width: 0 }),
  } as Record<string, unknown>,
  {
    get: (target, prop) => (prop in target ? target[prop as string] : () => {}),
    set: () => true,
  }
)
HTMLCanvasElement.prototype.getContext = vi.fn(() => contextStub) as never
