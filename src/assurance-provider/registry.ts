import type {
  AssuranceProviderActivationPolicyV1,
  AssuranceProviderDescriptorV1,
  AssuranceProviderDisposer,
  AssuranceProviderFactoryV1,
  AssuranceProviderUnavailableCode,
  AssuranceProviderV1,
  FrozenAssuranceProviderSelectionV1,
} from './contracts.js'
import { parseAssuranceProviderDescriptorV1 } from './contracts.js'
import { parseAssuranceProviderConfigurationV1 } from './contracts.js'

interface AssuranceProviderEntry {
  readonly descriptor: AssuranceProviderDescriptorV1
  readonly factory: AssuranceProviderFactoryV1
}

function descriptorKey(descriptor: AssuranceProviderDescriptorV1): string {
  return JSON.stringify([descriptor.providerId, descriptor.providerVersion])
}

/** Package-private failure classification that never carries Provider-owned diagnostics into persistence. */
export class AssuranceProviderResolutionError extends Error {
  constructor(readonly code: AssuranceProviderUnavailableCode) {
    super(`Assurance Provider resolution failed: ${code}`)
    this.name = 'AssuranceProviderResolutionError'
  }
}

/** Package-private startup Registry; callers receive no lookup or mutation handle. */
/** @internal */
export class AssuranceProviderRegistry {
  private readonly entries = new Map<string, AssuranceProviderEntry>()
  private registrationClosed = false

  register(
    candidate: AssuranceProviderDescriptorV1,
    factory: AssuranceProviderFactoryV1,
  ): AssuranceProviderDisposer {
    if (this.registrationClosed) {
      throw new TypeError('Assurance Provider registration is closed after Mission operation began')
    }
    const descriptor = parseAssuranceProviderDescriptorV1(candidate)
    const key = descriptorKey(descriptor)
    if (this.entries.has(key)) {
      throw new TypeError(
        `Assurance Provider '${descriptor.providerId}' version '${descriptor.providerVersion}' is already registered`,
      )
    }
    if (typeof factory !== 'function') throw new TypeError('Assurance Provider factory must be a function')
    const entry: AssuranceProviderEntry = { descriptor, factory }
    this.entries.set(key, entry)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
  }

  closeRegistration(): void {
    this.registrationClosed = true
  }

  /** Resolve exact Host selections only after startup composition has closed. */
  freezeSelections(
    policies: readonly AssuranceProviderActivationPolicyV1[],
  ): readonly FrozenAssuranceProviderSelectionV1[] {
    if (!this.registrationClosed) {
      throw new Error('Assurance Provider selections cannot freeze before registration closes')
    }
    const selections: FrozenAssuranceProviderSelectionV1[] = []
    for (const policy of policies) {
      if (policy.activation === 'disabled') continue
      const entry = this.entries.get(descriptorKey(policy.descriptor))
      if (entry === undefined) {
        if (policy.activation === 'required') {
          throw new TypeError(
            `Required Assurance Provider '${policy.descriptor.providerId}' version '${policy.descriptor.providerVersion}' is not registered`,
          )
        }
        continue
      }
      selections.push(Object.freeze({
        schemaVersion: 1,
        descriptor: parseAssuranceProviderDescriptorV1(entry.descriptor),
        activation: policy.activation,
        ...policy.configuration === undefined
          ? {}
          : { configuration: parseAssuranceProviderConfigurationV1(policy.configuration) },
      }))
    }
    return Object.freeze(selections)
  }

  /** Resolve one frozen exact selection to a process-local Provider without exposing the Registry. */
  resolveExact(candidate: AssuranceProviderDescriptorV1): AssuranceProviderV1 {
    if (!this.registrationClosed) {
      throw new Error('Assurance Provider execution cannot resolve before registration closes')
    }
    const expected = parseAssuranceProviderDescriptorV1(candidate)
    const entry = this.entries.get(descriptorKey(expected))
    if (entry === undefined) {
      throw new AssuranceProviderResolutionError('registration_missing')
    }

    let provider: AssuranceProviderV1
    try {
      provider = entry.factory(parseAssuranceProviderDescriptorV1(entry.descriptor))
    } catch {
      throw new AssuranceProviderResolutionError('factory_failed')
    }
    if (this.entries.get(descriptorKey(expected)) !== entry) {
      throw new AssuranceProviderResolutionError('registration_missing')
    }
    if (typeof provider !== 'object' || provider === null || typeof provider.assess !== 'function') {
      throw new AssuranceProviderResolutionError('invalid_provider')
    }

    let actual: AssuranceProviderDescriptorV1
    try {
      actual = parseAssuranceProviderDescriptorV1(provider.descriptor)
    } catch {
      throw new AssuranceProviderResolutionError('invalid_provider')
    }
    if (descriptorKey(actual) !== descriptorKey(expected)) {
      throw new AssuranceProviderResolutionError('descriptor_mismatch')
    }
    return provider
  }

  /** Revalidate one resolved exact entry synchronously after an awaited admission step. */
  isRegisteredExact(candidate: AssuranceProviderDescriptorV1): boolean {
    if (!this.registrationClosed) return false
    const expected = parseAssuranceProviderDescriptorV1(candidate)
    return this.entries.has(descriptorKey(expected))
  }

  clear(): void {
    this.entries.clear()
  }
}
