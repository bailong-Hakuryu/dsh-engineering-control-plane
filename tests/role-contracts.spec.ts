import { describe, expect, it } from 'vitest'
import { validateRoleOutput } from '../src/runner/role-contracts.ts'

describe('Role Output Contract validation', () => {
  it('normalizes an empty optional question accepted by the Harness schema', () => {
    expect(validateRoleOutput('reviewer', {
      schemaVersion: 1,
      outcome: 'reviewed',
      summary: 'The published Evidence was reviewed.',
      findings: [],
      question: '',
    })).toEqual({
      schemaVersion: 1,
      outcome: 'reviewed',
      summary: 'The published Evidence was reviewed.',
      findings: [],
    })
  })

  it('still requires a non-empty question when the role needs input', () => {
    expect(() => validateRoleOutput('reviewer', {
      schemaVersion: 1,
      outcome: 'needs_input',
      summary: 'A user decision is required.',
      findings: [],
      question: '',
    })).toThrow('question must be a non-empty string')
  })
})
