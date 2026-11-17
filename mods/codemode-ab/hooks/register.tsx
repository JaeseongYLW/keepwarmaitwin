import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayStats, Mode } from '../types'

const mismatchAtom = atom(
  { plugin: 'codemode-ab', key: 'mismatch' } as const,
  null as { today: Mode; running: Mode } | null,
)

const VERSION = '0.1.0'
const HOUR = 3_600_000
const ENV_KEY = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE'
const KNEXT_PREFIX = 'mcp__K-Next__'
const CODE_TOOL = 'REPL'

type Options = {
  participant?: string
  webhookUrl?: string
  manageSettings?: boolean
  utcOffsetHours?: number
}

function emptyStats(): DayStats {
  return {
    sessions: 0, prompts: 0, requests: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    modelToolUses: 0, knextModelCalls: 0, codeRuns: 0,
    executedToolCalls: 0, knextExecuted: 0, activeMs: 0, mismatchSessions: 0,
  }
}

async function today($: EngineInterface, offsetHours: number): Promise<string> {
  return new Date((await $.clock.now()) + offsetHours * HOUR).toISOString().slice(0, 10)
}

/** 하루치 지표에 값을 더한다. 키: stats:<날짜>|<모드> */
async function addStats($: EngineInterface, day: string, mode: Mode, patch: Partial<DayStats>) {
  const key = `stats:${day}|${mode}`
  const cur = { ...emptyStats(), ...((await $.store.get(key)) as Partial<DayStats> | undefined) }
  for (const [k, v] of Object.entries(patch) as [keyof DayStats, number][]) cur[k] += v
  await $.store.set(key, cur)
  const days = ((await $.store.get('days')) as string[] | undefined) ?? []
  if (!days.includes(`${day}|${mode}`)) await $.store.set('days', [...days, `${day}|${mode}`])
}

/** 오늘 배정된 모드. 없으면 50:50으로 정해 저장한다. */
async function assignment($: EngineInterface, day: string): Promise<Mode> {
  const saved = (await $.store.get(`assign:${day}`)) as Mode | undefined
  if (saved === 'on' || saved === 'off') return saved
  const mode: Mode = crypto.getRandomValues(new Uint8Array(1))[0]! % 2 === 0 ? 'on' : 'off'
  await $.store.set(`assign:${day}`, mode)
  return mode
}

/** ~/.claude/settings.json 의 env 에 Code Mode 값을 쓴다 (다음 실행부터 적용) */
async function writeSettings($: EngineInterface, mode: Mode): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return '홈 폴더를 찾지 못했습니다'
  const path = `${home}/.claude/settings.json`
  let obj: Record<string, unknown> = {}
  try {
    obj = JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch (err) {
    const exists = await $.fs.stat(path).then(() => true, () => false)
    if (exists) return 'settings.json을 읽지 못해 Code Mode 설정을 바꾸지 않았습니다'
  }
  const env = { ...((obj.env as Record<string, string> | undefined) ?? {}) }
  const want = mode === 'on' ? '1' : '0'
  if (env[ENV_KEY] === want) return undefined
  env[ENV_KEY] = want
  await $.fs.write(path, JSON.stringify({ ...obj, env }, null, 2) + '\n')
  return undefined
}

function card(participant: string, day: string, mode: Mode, s: DayStats) {
  const per = (n: number) => (s.prompts ? (n / s.prompts).toFixed(1) : '-')
  const total = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens
  const data = { v: VERSION, participant, day, mode, ...s }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', weight: 'Bolder', text: `[Code Mode 실험] ${participant} · ${day} · ${mode === 'on' ? '켬' : '끔'}` },
            {
              type: 'FactSet',
              facts: [
                { title: '세션 / 질문', value: `${s.sessions} / ${s.prompts}` },
                { title: '질문당 왕복', value: per(s.requests) },
                { title: '질문당 토큰', value: per(total) },
                { title: '질문당 K-System 호출', value: `${per(s.knextModelCalls)} (실행 ${per(s.knextExecuted)})` },
                { title: '코드 실행', value: String(s.codeRuns) },
                { title: '질문당 시간(초)', value: per(s.activeMs / 1000) },
              ],
            },
            { type: 'TextBlock', isSubtle: true, size: 'Small', wrap: true, text: `AB_DATA ${JSON.stringify(data)}` },
          ],
        },
      },
    ],
    codemodeAb: data,
  }
}

/** 아직 안 보낸 날짜(오늘 제외, includeToday면 포함)를 웹훅으로 보낸다 */
async function sendPending($: EngineInterface, o: Options, day: string, includeToday: boolean) {
  const url = (o.webhookUrl ?? '').trim()
  if (!url) return { sent: 0, failed: 0, note: '웹훅 URL이 설정되지 않았습니다' }
  const participant = (o.participant ?? '').trim() || 'unknown'
  const days = ((await $.store.get('days')) as string[] | undefined) ?? []
  let sent = 0
  let failed = 0
  for (const entry of days) {
    const [d, m] = entry.split('|') as [string, Mode]
    if (d > day || (d === day && !includeToday)) continue
    const s = (await $.store.get(`stats:${entry}`)) as DayStats | undefined
    if (!s || s.prompts === 0) continue
    const sentKey = `sent:${entry}`
    const sig = `${s.prompts}/${s.requests}`
    if ((await $.store.get(sentKey)) === sig) continue
    try {
      const r = await $.http.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card(participant, d, m, s)),
      })
      if (r.ok) {
        await $.store.set(sentKey, sig)
        sent += 1
      } else {
        failed += 1
      }
    } catch {
      failed += 1
    }
  }
  return { sent, failed, note: '' }
}

export const register: Register = (on, options) => {
  const o = (options ?? {}) as Options
  const offset = Number(o.utcOffsetHours ?? 9)
  let running: Mode = 'off'
  let humanTurn = false
  let turnDay = ''
  let promptAt = 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    running = (await $.env.get('CLAUDE_CODE_EXPERIMENTAL_CODE_MODE')) === '1' ? 'on' : 'off'
    const day = await today($, offset)
    const assigned = await assignment($, day)

    if (o.manageSettings !== false) {
      const err = await writeSettings($, assigned)
      if (err) $.ui.toast(`codemode-ab: ${err}`, { timeoutMs: 8000 })
    }
    const isMismatch = assigned !== running
    await update($, mismatchAtom, () => (isMismatch ? { today: assigned, running } : null))
    await addStats($, day, running, { sessions: 1, mismatchSessions: isMismatch ? 1 : 0 })

    await $.command.register({ name: 'ab-status', description: 'Code Mode 실험: 오늘 배정과 집계 보기' })
    await $.command.register({ name: 'ab-report', description: 'Code Mode 실험: 오늘까지의 결과를 지금 전송' })

    await sendPending($, o, day, false)
    $.clock.every(HOUR, () => {
      void (async () => sendPending($, o, await today($, offset), false))()
    })
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    humanTurn = kind === 'composer' || kind === 'bridge'
    if (humanTurn) {
      promptAt = await $.clock.now()
      turnDay = await today($, offset)
      await addStats($, turnDay, running, { prompts: 1 })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (humanTurn && e.agentId === undefined && r.usage) {
      const names = r.toolUses.map(t => t.name)
      await addStats($, turnDay, running, {
        requests: 1,
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheReadTokens: r.usage.cache_read_input_tokens,
        cacheWriteTokens: r.usage.cache_creation_input_tokens,
        modelToolUses: names.length,
        knextModelCalls: names.filter(n => n.startsWith(KNEXT_PREFIX)).length,
        codeRuns: names.filter(n => n === CODE_TOOL).length,
      })
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (humanTurn && e.agentId === undefined) {
      await addStats($, turnDay, running, {
        executedToolCalls: 1,
        knextExecuted: e.tool.startsWith(KNEXT_PREFIX) ? 1 : 0,
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (humanTurn && e.agentId === undefined) {
      await addStats($, turnDay, running, { activeMs: (await $.clock.now()) - promptAt })
      humanTurn = false
    }
    return result
  })

  on('command.run', { command: 'ab-status' }, async $ => {
    const day = await today($, offset)
    const assigned = await assignment($, day)
    const lines = [
      `오늘(${day}) 배정: Code Mode ${assigned === 'on' ? '켬' : '끔'} / 지금 실행 중: ${running === 'on' ? '켬' : '끔'}`,
    ]
    if (assigned !== running) lines.push('→ /exit 후 claude를 다시 실행하면 배정대로 바뀝니다.')
    for (const m of ['off', 'on'] as const) {
      const s = (await $.store.get(`stats:${day}|${m}`)) as DayStats | undefined
      if (s) lines.push(`오늘 ${m === 'on' ? '켬' : '끔'}: 세션 ${s.sessions}, 질문 ${s.prompts}, 왕복 ${s.requests}, K-System ${s.knextModelCalls}(실행 ${s.knextExecuted}), 코드 실행 ${s.codeRuns}`)
    }
    lines.push(`참가자: ${(o.participant ?? '').trim() || '(미설정)'} / 전송: ${(o.webhookUrl ?? '').trim() ? '설정됨' : '미설정'}`)
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'ab-report' }, async $ => {
    const r = await sendPending($, o, await today($, offset), true)
    if (r.note) return { text: `codemode-ab: ${r.note}` }
    return { text: `codemode-ab: ${r.sent}건 전송${r.failed ? `, ${r.failed}건 실패` : ''}${r.sent + r.failed === 0 ? ' (새로 보낼 내용 없음)' : ''}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mm = await read($, mismatchAtom)
    if (mm === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow">
          [Code Mode 실험] 오늘은 Code Mode {mm.today === 'on' ? '켬' : '끔'} 날입니다. /exit 후 claude를 다시 실행해 주세요.
        </Text>
      </Box>
    )
  })
}
