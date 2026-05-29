import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RoiEditor from '../components/RoiEditor'

// 1×1 transparent PNG data URL — component requires a truthy backgroundImage to render
const BLANK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('RoiEditor', () => {
  it('renders canvas element', () => {
    render(
      <RoiEditor
        backgroundImage={BLANK_IMAGE}
        rois={[]}
        onRoisChange={vi.fn()}
      />
    )
    expect(document.querySelector('canvas')).toBeTruthy()
  })

  it('renders Polygon and Rectangle toolbar buttons', () => {
    render(
      <RoiEditor
        backgroundImage={BLANK_IMAGE}
        rois={[]}
        onRoisChange={vi.fn()}
      />
    )
    expect(screen.getByText('Polygon')).toBeTruthy()
    expect(screen.getByText('Rectangle')).toBeTruthy()
  })
})
