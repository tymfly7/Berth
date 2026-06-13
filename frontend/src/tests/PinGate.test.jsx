import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PinGate from '../components/PinGate'

// Read the operands from the "What is X + Y?" label and return their sum.
const solveChallenge = () => {
  const [a, b] = screen.getByText(/What is \d+ \+ \d+\?/).textContent.match(/\d+/g).map(Number)
  return String(a + b)
}

const signIn = async (user, { username = 'admin', password = 'password' } = {}) => {
  await user.type(screen.getByPlaceholderText('admin'), username)
  await user.type(screen.getByPlaceholderText('••••••••'), password)
  await user.type(screen.getByPlaceholderText('Answer'), solveChallenge())
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('PinGate', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Server-side login is now validated by the backend; mock it: the correct
    // password is "password", anything else is rejected.
    global.fetch = vi.fn(async (_url, opts) => {
      const { password } = JSON.parse(opts.body)
      if (password === 'password') {
        return { ok: true, status: 200, json: async () => ({ token: '9999999999.sig', expires_in: 28800 }) }
      }
      return { ok: false, status: 401, json: async () => ({ detail: 'Incorrect password' }) }
    })
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

  it('grants access with correct credentials and a solved challenge', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    await signIn(user)

    expect(await screen.findByText('admin content')).toBeTruthy()
    expect(sessionStorage.getItem('admin_token')).toBe('9999999999.sig')
  })

  it('shows error message for incorrect credentials', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    await signIn(user, { username: 'wrong', password: '0000' })

    expect(await screen.findByText('Incorrect username or password')).toBeTruthy()
    expect(screen.queryByText('admin content')).toBeNull()
  })

  it('rejects when the math challenge answer is wrong', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    await user.type(screen.getByPlaceholderText('admin'), 'admin')
    await user.type(screen.getByPlaceholderText('••••••••'), 'password')
    await user.type(screen.getByPlaceholderText('Answer'), '-1')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByText('Incorrect answer to the challenge')).toBeTruthy()
    expect(screen.queryByText('admin content')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects when the honeypot field is filled (bot)', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    // Even with otherwise-valid input, a filled honeypot blocks access.
    await user.type(screen.getByPlaceholderText('admin'), 'admin')
    await user.type(screen.getByPlaceholderText('••••••••'), 'password')
    await user.type(screen.getByPlaceholderText('Answer'), solveChallenge())
    await user.type(screen.getByLabelText('Company'), 'spam-corp')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.queryByText('admin content')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('locks the form after 5 failed attempts', async () => {
    const user = userEvent.setup()
    render(
      <PinGate>
        <div>admin content</div>
      </PinGate>
    )

    for (let i = 1; i <= 5; i++) {
      await user.clear(screen.getByPlaceholderText('admin'))
      await user.type(screen.getByPlaceholderText('admin'), 'wrong')
      await user.type(screen.getByPlaceholderText('••••••••'), 'wrong-pass')
      await user.type(screen.getByPlaceholderText('Answer'), solveChallenge())
      await user.click(screen.getByRole('button', { name: /sign in|locked/i }))
      // Wait for this attempt's failure to register before the next iteration,
      // so the async login response settles and the challenge resets.
      await waitFor(() => expect(Number(localStorage.getItem('admin_fail_count') || 0)).toBe(i))
    }

    expect(screen.getByText(/Too many attempts/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Locked/ })).toBeTruthy()
  })
})
