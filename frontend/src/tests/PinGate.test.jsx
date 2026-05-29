import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import PinGate from '../components/PinGate'

describe('PinGate', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows login form and hides children when not authenticated', () => {
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )
    expect(screen.getByText('Admin Access')).toBeTruthy()
    expect(screen.queryByText('admin content')).toBeNull()
  })

  it('grants access with correct credentials', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    await user.type(screen.getByPlaceholderText('admin'), 'admin')
    await user.type(screen.getByPlaceholderText('••••••••'), 'password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByText('admin content')).toBeTruthy()
  })

  it('shows error message for incorrect credentials', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    await user.type(screen.getByPlaceholderText('admin'), 'wrong')
    await user.type(screen.getByPlaceholderText('••••••••'), '0000')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByText('Incorrect username or password')).toBeTruthy()
    expect(screen.queryByText('admin content')).toBeNull()
  })
})
