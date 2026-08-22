import { describe, expect, it } from 'vitest'
import type { AssuranceProviderActivationConfig, Config } from '../src/config.ts'
import {
  createEffectivePolicy,
  resolveAssuranceProviderActivations,
  resolveDeploymentConfig,
} from '../src/policy.ts'

function config(): Config {
  const category = { mode: 'not_applicable' as const, reason: 'Not required for this fixture.' }
  return {
    subagentProvider: 'spawn',
    maxSubagentDepth: 1,
    rolePolicies: {
      planner: { allowTools: ['read'], denyTools: [] },
      developer: { allowTools: ['read', 'edit'], denyTools: [], model: 'developer-model' },
      tester: { allowTools: ['read'], denyTools: [] },
      reviewer: { allowTools: ['read'], denyTools: [] },
    },
    repositories: [{ root: 'D:/fixture', verificationProfile: 'fixture' }],
    verificationProfiles: [{
      name: 'fixture',
      categories: {
        functional: {
          mode: 'commands',
          commands: [{
            name: 'unit',
            argv: ['pnpm', 'test'],
            timeoutMs: 30_000,
            environmentNames: [],
          }],
        },
        negative: category,
        regression: category,
        security: category,
      },
    }],
    gitCommand: 'git-fixture',
    gitCommandTimeoutMs: 45_000,
    terminationGraceMs: 3_000,
  }
}

describe('Effective Policy', () => {
  it('strictly canonicalizes detached Assurance Provider activation policy', () => {
    const configured: AssuranceProviderActivationConfig[] = [
      {
        providerId: 'fixture/z-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'when-available',
      },
      {
        providerId: 'fixture/a-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'required',
      },
    ]
    const resolved = resolveAssuranceProviderActivations(configured)

    expect(resolved.map(policy => policy.descriptor.providerId)).toEqual([
      'fixture/a-provider',
      'fixture/z-provider',
    ])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved[0])).toBe(true)
    configured[0]!.providerId = 'caller/mutated'
    expect(resolved[1]!.descriptor.providerId).toBe('fixture/z-provider')

    expect(() => resolveAssuranceProviderActivations([
      {
        providerId: 'fixture/duplicate-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'required',
      },
      {
        providerId: 'fixture/duplicate-provider',
        providerVersion: '1.0.0-fixture.1',
        activation: 'when-available',
      },
    ])).toThrow(
      "Assurance Provider activation 'fixture/duplicate-provider' version '1.0.0-fixture.1' is duplicated",
    )

    const unknownField = {
      providerId: 'fixture/strict-provider',
      providerVersion: '1.0.0-fixture.1',
      activation: 'required',
      fallbackVersion: 'latest',
    } as unknown as AssuranceProviderActivationConfig
    expect(() => resolveAssuranceProviderActivations([unknownField])).toThrow(
      "repositories[].assuranceProviders[0] contains unknown field 'fallbackVersion'",
    )
  })

  it('materializes and freezes the complete redacted execution policy with a stable digest', () => {
    const deployment = resolveDeploymentConfig(config())
    const first = createEffectivePolicy(deployment, 'fixture')
    const second = createEffectivePolicy(resolveDeploymentConfig(config()), 'fixture')

    expect(first).toEqual(second)
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(first).toMatchObject({
      schemaVersion: 1,
      verificationProfile: 'fixture',
      subagentProvider: 'spawn',
      maxSubagentDepth: 1,
      rolePolicies: {
        developer: { allowTools: ['read', 'edit'], model: 'developer-model' },
      },
      verification: { name: 'fixture' },
      artifactBudgets: {
        maxRecordBytes: 16 * 1024 * 1024,
        maxUntrackedFiles: 256,
      },
      hostExecution: {
        gitCommand: 'git-fixture',
        gitCommandTimeoutMs: 45_000,
        terminationGraceMs: 3_000,
      },
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.rolePolicies?.developer)).toBe(true)
    expect(Object.isFrozen(first.verification?.categories.functional)).toBe(true)
  })

  it('rejects embedded credential-shaped command arguments before a Mission can start', () => {
    const invalid = config()
    const functional = invalid.verificationProfiles[0]!.categories.functional
    if (functional.mode !== 'commands') throw new Error('fixture is malformed')
    functional.commands[0]!.argv = ['tool', '--api-key=secret-value']

    expect(() => resolveDeploymentConfig(invalid)).toThrow('embeds a credential-shaped argument')
  })

  it('rejects every subagent provider except the fixed in-process spawn provider', () => {
    const invalid = {
      ...config(),
      subagentProvider: 'remote-provider',
    } as unknown as Config

    expect(() => resolveDeploymentConfig(invalid)).toThrow(
      "subagentProvider must be the fixed in-process 'spawn' provider",
    )
  })

  it('rejects role policies whose effective capability sets contradict each other', () => {
    const invalid = config()
    invalid.rolePolicies.developer.denyTools.push('edit')

    expect(() => resolveDeploymentConfig(invalid)).toThrow("both allows and denies 'edit'")
  })

  it('fails closed when role policy could mutate Git history or violate read-only authority', () => {
    const developerShell = config()
    developerShell.rolePolicies.developer.allowTools.push('pwsh')
    expect(() => resolveDeploymentConfig(developerShell)).toThrow(
      "rolePolicies.developer cannot allow authority-sensitive or unknown tool 'pwsh'",
    )

    const plannerWrite = config()
    plannerWrite.rolePolicies.planner.allowTools.push('write')
    expect(() => resolveDeploymentConfig(plannerWrite)).toThrow(
      "rolePolicies.planner cannot allow authority-sensitive or unknown tool 'write'",
    )
  })
})
