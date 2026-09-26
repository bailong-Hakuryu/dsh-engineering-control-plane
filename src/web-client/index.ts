/**
 * Browser half of the Engineering Control Plane for the Harness Web client
 * module system. It only replaces the generic rows of the five Mission tools
 * with purpose-built cards; it holds no authority, calls no Service, and reads
 * nothing beyond the tool-call blocks the conversation already has.
 */
import { en, zh } from './locales.js'
import { MISSION_TOOL_CARD_NAMES } from './model.js'
import { MISSION_TOOL_CARD_CSS, MissionToolCard } from './card.js'

/** Locale namespace bound to every Mission card's `t`. */
export const MISSION_TOOL_CARD_NAMESPACE = 'dsh-engineering-control-plane.mission-cards'

interface StyleHost {
  readonly head: { appendChild(node: unknown): unknown }
  createElement(tag: 'style'): { textContent: string | null; dataset: Record<string, string>; remove(): void }
}

/** Client services the cards need; everything else stays with the Host. */
interface ToolCardClientContext {
  effect(execute: () => () => void, label?: string): unknown
  readonly slots: {
    inject(name: string, register: () => () => void): unknown
    register(
      options: { readonly name: string; readonly key: string; readonly locale: string },
      component: unknown,
    ): () => void
  }
  readonly locale: {
    register(namespace: string, dictionaries: { readonly zh: typeof zh; readonly en: typeof en }): () => void
  }
}

export const name = 'dsh-engineering-control-plane/client'
export const inject = ['slots', 'locale']

function installStyles(): () => void {
  const document = (globalThis as { document?: StyleHost }).document
  if (document === undefined) return () => {}
  const style = document.createElement('style')
  style.dataset['plugin'] = 'dsh-engineering-control-plane'
  style.textContent = MISSION_TOOL_CARD_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

export function apply(ctx: ToolCardClientContext): void {
  ctx.effect(installStyles, 'dsh-engineering-control-plane: mission card styles')
  ctx.effect(
    () => ctx.locale.register(MISSION_TOOL_CARD_NAMESPACE, { zh, en }),
    'dsh-engineering-control-plane: mission card dictionaries',
  )
  for (const toolName of MISSION_TOOL_CARD_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: toolName,
      locale: MISSION_TOOL_CARD_NAMESPACE,
    }, MissionToolCard))
  }
}
