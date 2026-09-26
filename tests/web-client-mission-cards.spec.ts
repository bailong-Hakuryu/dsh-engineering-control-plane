import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildWebClient } from '../scripts/build-web-client.mjs'
import { en, zh } from '../src/web-client/locales.ts'
import {
  MISSION_TOOL_CARD_NAMES,
  missionToolCard,
  type CardLabel,
  type ToolCardModel,
} from '../src/web-client/model.ts'

const MISSION_ID = 'mission-4f3a9c21-0b7e-4d2a-9f11-6c2d8e5a7b10'

function running(name: string, args: unknown) {
  return {
    callId: `call-${name}`,
    name,
    argsRaw: typeof args === 'string' ? args : JSON.stringify(args),
    turn: 1,
    step: 1,
    time: 0,
    subCalls: [],
  }
}

function settled(name: string, args: unknown, output: unknown, isError = false) {
  return {
    kind: 'tool-result' as const,
    seq: 1,
    time: 0,
    callId: `call-${name}`,
    call: { name, argsRaw: JSON.stringify(args) },
    callTime: 0,
    content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
    isError,
    subCalls: [],
  }
}

function text(label: CardLabel): string {
  if ('literal' in label) return label.literal
  if ('join' in label) return label.join.map(text).join(label.separator ?? ' · ')
  return zh[label.key].replace(/\{(\w+)\}/gu, (_m, name: string) => {
    const value = label.values?.[name]
    return value === undefined ? `{${name}}` : typeof value === 'object' ? text(value) : String(value)
  })
}

const summaryText = (model: ToolCardModel) => model.summary.map(text).join(' · ')
const chipTexts = (model: ToolCardModel) => model.chips.map(chip => `${text(chip.label)}:${chip.tone}`)
const fieldTexts = (model: ToolCardModel) => model.fields.map(field => [text(field.label), text(field.value)])

function status(overrides: Record<string, unknown> = {}) {
  return {
    missionId: MISSION_ID,
    revision: 7,
    status: 'BLOCKED',
    attempt: 2,
    effectivePolicyDigest: 'sha256:policy',
    repository: { canonicalRoot: 'D:/work/app', branch: 'mission/readme', head: '0123456789abcdef0123' },
    writeLease: { fencingToken: 4, active: false },
    blocked: { code: 'needs_input', resumeStatus: 'IMPLEMENTING', blockedAt: '2026-09-26T00:00:00Z' },
    gate: null,
    assuranceResults: [
      { requirementId: 'security', attempt: 1, outcome: 'indeterminate', assessmentIds: [], reasonCodes: [] },
    ],
    roleRuns: [
      { runId: 'r1', attempt: 1, role: 'planner', state: 'completed', evidenceRecordIds: [] },
      { runId: 'r2', attempt: 2, role: 'developer', state: 'failed', evidenceRecordIds: [] },
    ],
    evidence: [],
    roleRunsTruncated: false,
    evidenceTruncated: false,
    assuranceResultsTruncated: false,
    legalNextActions: ['mission_status', 'mission_resume', 'mission_cancel'],
    ...overrides,
  }
}

describe('Mission tool card view models', () => {
  it('covers every Mission model tool', () => {
    expect([...MISSION_TOOL_CARD_NAMES].sort()).toEqual([
      'mission_cancel',
      'mission_resume',
      'mission_rework',
      'mission_start',
      'mission_status',
    ])
  })

  it('shows the objective while a Mission start is running and its receipt once accepted', () => {
    const args = { objective: 'Add a README section describing the install script' }
    const pending = missionToolCard('mission_start', running('mission_start', args))
    expect(pending.state).toBe('running')
    expect(summaryText(pending)).toBe('Add a README section describing the install script')

    const accepted = missionToolCard('mission_start', settled('mission_start', args, {
      missionId: MISSION_ID, revision: 1, status: 'CREATED', attempt: 1, acceptedAt: '2026-09-26T00:00:00Z',
    }))
    expect(summaryText(accepted)).toBe('Add a README section describing the install script · 已接受 mission-4f3a9c21')
    expect(chipTexts(accepted)).toEqual(['已创建:info'])
  })

  it('explains a blocked Mission with its reason, roles, assurance, and next actions', () => {
    const model = missionToolCard('mission_status', settled('mission_status', { missionId: MISSION_ID }, status()))
    expect(summaryText(model)).toBe('mission/readme · 第 2 次尝试')
    expect(chipTexts(model)).toEqual(['已阻塞:warning', '需要补充信息:warning'])
    expect(fieldTexts(model)).toEqual([
      ['Mission', MISSION_ID],
      ['修订', '7'],
      ['分支', 'mission/readme @ 01234567'],
      ['角色', '规划 · 已完成 / 开发 · 失败'],
      ['保障', 'security · 无法判定'],
      ['可执行操作', '查看状态 · 恢复 · 取消'],
    ])
  })

  it('reports the review gate without inventing a blocked reason', () => {
    const model = missionToolCard('mission_status', settled('mission_status', { missionId: MISSION_ID }, status({
      status: 'APPROVED',
      blocked: null,
      gate: { kind: 'approved', reasons: [] },
      legalNextActions: ['mission_status'],
    })))
    expect(chipTexts(model)).toEqual(['已通过:success', '门禁通过:success'])
  })

  it('summarizes resume, rework, and cancel receipts', () => {
    for (const name of ['mission_resume', 'mission_rework', 'mission_cancel'] as const) {
      const model = missionToolCard(name, settled(name, { missionId: MISSION_ID, expectedRevision: 7 }, {
        missionId: MISSION_ID, revision: 8, status: name === 'mission_cancel' ? 'CANCELLED' : 'IMPLEMENTING', attempt: 3, acceptedAt: 'x',
      }))
      expect(summaryText(model)).toBe('mission-4f3a9c21 · 修订 8')
    }
    const cancelled = missionToolCard('mission_cancel', settled('mission_cancel', { missionId: MISSION_ID }, {
      missionId: MISSION_ID, revision: 8, status: 'CANCELLED', attempt: 3, acceptedAt: 'x',
    }))
    expect(chipTexts(cancelled)).toEqual(['已取消:neutral'])
  })

  it('surfaces errors and survives truncated or foreign payloads', () => {
    const failed = missionToolCard('mission_status', settled('mission_status', { missionId: MISSION_ID }, 'Mission not found\nstack', true))
    expect(failed.state).toBe('error')
    expect(failed.errorText).toBe('Mission not found')
    expect(failed.chips).toEqual([])

    expect(missionToolCard('mission_start', running('mission_start', '{"objec')).summary).toEqual([])
    const foreign = missionToolCard('mission_status', settled('mission_status', {}, { roleRuns: 'x', legalNextActions: 7 }))
    expect(foreign.fields).toEqual([])
    expect(missionToolCard('mission_status', undefined).state).toBe('running')
  })

  it('ships identical Chinese and English dictionaries', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('Mission web client bundle', () => {
  it('builds a loader factory that registers every Mission card and requires only React', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'dsh-cp-web-client-'))
    const outFile = join(outDir, 'client.js')
    await buildWebClient({ outFile })
    const source = await readFile(outFile, 'utf8')

    const registrations: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }[] = []
    runInNewContext(source, { window: { __ModuleLoader__: { load: (entry: never) => registrations.push(entry) } } })
    expect(registrations.map(entry => entry.id)).toEqual(['dsh-engineering-control-plane'])

    const requested: string[] = []
    const react = { createElement: () => null, useState: <S>(value: S) => [value, () => {}] }
    const exports = registrations[0]!.factory((id) => {
      requested.push(id)
      if (id === 'react') return react
      throw new Error(`unexpected module request ${id}`)
    })
    expect(requested).toEqual(['react'])
    expect(exports['inject']).toEqual(['slots', 'locale'])

    const views: string[] = []
    const locales: string[] = []
    const effects: (() => unknown)[] = []
    ;(exports['apply'] as (ctx: unknown) => void)({
      effect: (execute: () => unknown) => { effects.push(execute) },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: { name: string; key: string; locale: string }) => {
          views.push(`${options.name}:${options.key}:${options.locale}`)
          return () => {}
        },
      },
      locale: { register: (namespace: string) => { locales.push(namespace); return () => {} } },
    })
    for (const effect of effects) effect()
    expect(views.sort()).toEqual([...MISSION_TOOL_CARD_NAMES].sort().map(
      name => `tool.call.toolview:${name}:dsh-engineering-control-plane.mission-cards`,
    ))
    expect(locales).toEqual(['dsh-engineering-control-plane.mission-cards'])
  })
})
