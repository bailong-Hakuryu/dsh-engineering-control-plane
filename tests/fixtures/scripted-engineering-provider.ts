import type { SubagentProvider, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { RoleName } from '../../src/kernel/types.js'

const outputs: Readonly<Record<RoleName, unknown>> = {
  planner: {
    schemaVersion: 1,
    outcome: 'planned',
    summary: 'Execute one bounded fixture plan.',
    steps: [{ id: 'step-1', objective: 'Complete the fixture', acceptanceSignals: ['fixture completes'] }],
    risks: [],
    verificationFocus: ['functional', 'negative', 'regression', 'security'],
  },
  developer: {
    schemaVersion: 1,
    outcome: 'implemented',
    summary: 'The fixture requires no repository mutation.',
    changedAreas: [],
    notes: [],
  },
  tester: {
    schemaVersion: 1,
    outcome: 'assessed',
    summary: 'Host fixture verification completed.',
    findings: [],
  },
  reviewer: {
    schemaVersion: 1,
    outcome: 'reviewed',
    summary: 'No blocking fixture finding remains.',
    findings: [],
  },
}

/** Register the deterministic release-test Provider required by ADR 0067. */
export function registerScriptedEngineeringProvider(
  subagents: Pick<SubagentRuntime, 'registerProvider'>,
): () => void {
  let sequence = 0
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: {
      outputSchema: true,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    },
    inheritsParentContext: false,
    async start(request) {
      const role = request.label?.split(' · ')[0]
      if (role !== 'planner' && role !== 'developer' && role !== 'tester' && role !== 'reviewer') {
        throw new Error('Scripted engineering Provider received an unknown Role label')
      }
      return {
        id: `scripted-engineering-${++sequence}` as never,
        localAgent: undefined,
        result: Promise.resolve({
          output: [],
          structured: outputs[role],
          stopReason: 'completed',
        }),
        dispose: () => Promise.resolve(),
      }
    },
  }
  return subagents.registerProvider(provider)
}
