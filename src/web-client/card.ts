/**
 * Mission tool card view. It mirrors the Harness tool row — one 24px line of
 * icon, title, and summary that expands into details — and adds status chips
 * whose meaning never relies on color alone. All text renders through React
 * text nodes; nothing is injected as HTML.
 */
import { createElement as h, useState } from 'react'
import type { ReactNode } from 'react'
import { missionToolCard } from './model.js'
import type { CardLabel } from './model.js'

/** Namespace-bound translator the Harness slot passes to a keyed tool view. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

export interface MissionToolCardProps {
  readonly toolName: string
  readonly block: unknown
  readonly t: Translate
  readonly inspect?: (() => void) | undefined
}

function render(label: CardLabel, t: Translate): string {
  if ('literal' in label) return label.literal
  if ('join' in label) return label.join.map(part => render(part, t)).join(label.separator ?? ' · ')
  const values: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(label.values ?? {})) {
    values[name] = typeof value === 'object' ? render(value, t) : value
  }
  return t(label.key, values)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function missionIcon(): ReactNode {
  return h('svg', { className: 'dcp-tc-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
    h('path', {
      d: 'M3.5 14V2.5m0 0h7.2l-1.4 2.6 1.4 2.6H3.5',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }))
}

function chevron(): ReactNode {
  return h('svg', { className: 'dcp-tc-chevron', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
    h('path', { d: 'm4.5 2.5 3.5 3.5-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }))
}

/** One Mission tool call rendered as a compact, expandable card. */
export function MissionToolCard(props: MissionToolCardProps): ReactNode {
  const { t } = props
  const model = missionToolCard(props.toolName, props.block)
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const summary = model.state === 'error'
    ? model.errorText ?? ''
    : model.summary.map(label => render(label, t)).join(' · ')
  const header = h('button', {
    type: 'button',
    className: 'dcp-tc-row',
    'aria-expanded': open,
    onClick: () => { setOpen(value => !value) },
  },
  missionIcon(),
  h('span', { className: 'dcp-tc-title' }, render(model.title, t)),
  summary.length === 0 ? null : h('span', { className: 'dcp-tc-sep', 'aria-hidden': true }),
  h('span', {
    className: model.state === 'error' ? 'dcp-tc-summary dcp-tc-error' : 'dcp-tc-summary',
    title: summary,
  }, summary),
  ...model.chips.map(chip => h('span', { className: 'dcp-tc-chip', 'data-tone': chip.tone }, render(chip.label, t))),
  chevron())
  if (!open) return h('div', { className: 'dcp-tc', 'data-state': model.state, 'data-tool': props.toolName }, header)
  const body = h('div', { className: 'dcp-tc-body' },
    model.fields.length === 0
      ? null
      : h('dl', { className: 'dcp-tc-fields' },
          ...model.fields.flatMap(field => [
            h('dt', null, render(field.label, t)),
            h('dd', null, render(field.value, t)),
          ])),
    h('div', { className: 'dcp-tc-actions' },
      h('button', {
        type: 'button',
        className: 'dcp-tc-link',
        'aria-expanded': raw,
        onClick: () => { setRaw(value => !value) },
      }, t(raw ? 'action.hideRaw' : 'action.raw')),
      props.inspect === undefined
        ? null
        : h('button', { type: 'button', className: 'dcp-tc-link', onClick: props.inspect }, t('action.details'))),
    raw ? h('div', { className: 'dcp-tc-rawpair' },
      h('span', { className: 'dcp-tc-rawlabel' }, t('raw.input')),
      h('pre', { className: 'dcp-tc-raw' }, pretty(model.rawInput)),
      model.rawOutput === null ? null : h('span', { className: 'dcp-tc-rawlabel' }, t('raw.output')),
      model.rawOutput === null ? null : h('pre', { className: 'dcp-tc-raw' }, pretty(model.rawOutput))) : null)
  return h('div', { className: 'dcp-tc', 'data-state': model.state, 'data-tool': props.toolName }, header, body)
}

/**
 * Card styles use only Harness theme tokens present in every supported
 * Harness version, so light, dark, and font-size settings apply unchanged.
 */
export const MISSION_TOOL_CARD_CSS = `
.dcp-tc{display:flex;flex-direction:column}
.dcp-tc-row{all:unset;box-sizing:border-box;position:relative;overflow:hidden;display:flex;align-items:center;gap:6px;width:100%;min-height:24px;cursor:pointer;border-radius:6px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary)}
.dcp-tc-row:hover .dcp-tc-title{color:var(--dsw-alias-label-primary)}
.dcp-tc-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dcp-tc-icon{flex:none;color:var(--dsw-alias-state-business-primary)}
.dcp-tc-title{flex:none;white-space:nowrap}
.dcp-tc-sep{flex:none;width:2px;height:2px;border-radius:1px;margin:0 2px;background:var(--dsw-alias-label-caption)}
.dcp-tc-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.dcp-tc-error{color:var(--dsw-alias-state-error-primary)}
.dcp-tc-chip{flex:none;padding:0 6px;border:0.5px solid currentColor;border-radius:999px;font-size:11px;line-height:17px;white-space:nowrap}
.dcp-tc-chip[data-tone=neutral]{color:var(--dsw-alias-label-tertiary)}
.dcp-tc-chip[data-tone=info]{color:var(--dsw-alias-state-business-primary)}
.dcp-tc-chip[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.dcp-tc-chip[data-tone=warning]{color:var(--dsw-alias-state-warn-primary)}
.dcp-tc-chip[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}
.dcp-tc-chevron{flex:none;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}
.dcp-tc-row[aria-expanded=true] .dcp-tc-chevron{transform:rotate(90deg)}
.dcp-tc[data-state=running] .dcp-tc-row::after{content:'';position:absolute;top:0;bottom:0;left:0;width:300px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);animation:dcp-tc-sweep 2.6s ease-out infinite;pointer-events:none}
@keyframes dcp-tc-sweep{0%{left:-300px}90%,100%{left:100%}}
@media (prefers-reduced-motion:reduce){.dcp-tc[data-state=running] .dcp-tc-row::after{animation:none;display:none}.dcp-tc-chevron{transition:none}}
.dcp-tc-body{display:flex;flex-direction:column;gap:8px;margin:2px 0 6px 20px;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px}
.dcp-tc-fields{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0;font-size:12px;line-height:18px}
.dcp-tc-fields dt{color:var(--dsw-alias-label-tertiary)}
.dcp-tc-fields dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dcp-tc-actions{display:flex;gap:12px}
.dcp-tc-link{all:unset;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-decoration:underline dotted;text-underline-offset:3px}
.dcp-tc-link:hover{color:var(--dsw-alias-label-primary)}
.dcp-tc-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dcp-tc-rawpair{display:flex;flex-direction:column;gap:4px}
.dcp-tc-rawlabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dcp-tc-raw{margin:0;padding:8px;max-height:240px;overflow:auto;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
`
