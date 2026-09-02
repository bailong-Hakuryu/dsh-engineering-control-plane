import { Context, Service } from '@deepseek-ai/cordis'
import { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as missionTools from '../src/tools.ts'

class StubControlPlane extends Service {
  constructor(ctx: Context) {
    super(ctx, 'engineeringControlPlane')
  }
}

function stubAgent(origin?: 'subagent'): { agent: Agent; steer: ReturnType<typeof vi.fn> } {
  const id = SessionId(`command-routing-${Math.random()}`)
  // Harness `0.1.2-alpha.4` added a required, runtime-validated `isSeeded`
  // header flag (ADR 0092); a fresh unseeded fixture supplies it while staying
  // header-compatible with earlier versions that do not declare it.
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    isSeeded: false,
    ...origin === undefined ? {} : { origin },
  } as SessionHeader)
  let status: AgentStatus = 'idle'
  const steer = vi.fn()
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer,
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => {
      status = 'running'
      return task(new AbortController().signal).finally(() => { status = 'idle' })
    },
    whenIdle: () => Promise.resolve(),
  }
  return { agent, steer }
}

async function harness() {
  const ctx = new Context()
  const systemPromptFiber = await ctx.plugin(SystemPrompt)
  const commandFiber = await ctx.plugin(CommandRuntime)
  const toolFiber = await ctx.plugin(ToolRuntime)
  const serviceFiber = await ctx.plugin(StubControlPlane)
  const adapterFiber = await ctx.plugin(missionTools)
  return {
    ctx,
    async dispose() {
      await adapterFiber.dispose()
      await serviceFiber.dispose()
      await toolFiber.dispose()
      await commandFiber.dispose()
      await systemPromptFiber.dispose()
    },
  }
}

describe('Mission user routing', () => {
  it('advertises natural-language routing on mission_start', async () => {
    const fixture = await harness()
    try {
      const description = fixture.ctx.tools.get('mission_start')?.description
      expect(description).toContain('Default top-level entry point')
      expect(description).toContain('direct/ordinary mode')
      expect(description).toContain('do not duplicate that work directly')
    } finally {
      await fixture.dispose()
    }
  })

  it('registers /mission and steers a typed-tool request for a top-level agent', async () => {
    const fixture = await harness()
    const root = stubAgent()
    try {
      expect(fixture.ctx.commands.list(root.agent)).toContainEqual({
        name: 'mission',
        description: 'Start a governed engineering Mission',
        input: { hint: '<objective>' },
      })

      const execution = await fixture.ctx.commands.execute(
        root.agent,
        '/mission Fix the Windows release gate',
        [],
        new AbortController().signal,
      )

      expect(execution?.result).toEqual({ kind: 'success', text: 'Mission request submitted.' })
      expect(root.steer).toHaveBeenCalledOnce()
      const message = root.steer.mock.calls[0]?.[0] as ReturnType<typeof createUserMessage>
      expect(message.content).toEqual([{ type: 'text', text: expect.stringContaining('Call mission_start before making repository changes.') }])
      expect(message.content).toEqual([{ type: 'text', text: expect.stringContaining('Fix the Windows release gate') }])
    } finally {
      await fixture.dispose()
    }
  })

  it('rejects empty and delegated /mission invocations without steering', async () => {
    const fixture = await harness()
    const root = stubAgent()
    const child = stubAgent('subagent')
    try {
      const empty = await fixture.ctx.commands.execute(root.agent, '/mission', [], new AbortController().signal)
      const delegated = await fixture.ctx.commands.execute(
        child.agent,
        '/mission Start a nested mission',
        [],
        new AbortController().signal,
      )
      expect(empty?.result).toEqual({ kind: 'error', text: 'Usage: /mission <objective>' })
      expect(delegated?.result).toEqual({ kind: 'error', text: '/mission is available only in a top-level session.' })
      expect(root.steer).not.toHaveBeenCalled()
      expect(child.steer).not.toHaveBeenCalled()
    } finally {
      await fixture.dispose()
    }
  })
})
