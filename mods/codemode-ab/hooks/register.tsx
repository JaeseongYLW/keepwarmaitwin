import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayStats, Mode } from '../types'

// 주의: tool.call / tool.check 같은 도구 호출 훅을 쓰면 Code Mode가 켜지지 않는다.
// 이 모드는 turn.step(모델 요청 단위)만으로 지표를 모은다.

const mismatchAtom = atom(
  { plugin: 'codemode-ab', key: 'mismatch' } as const,
  null as { today: Mode; running: Mode } | null,
)

const VERSION = '0.2.0'
const MIN = 60_000
const HOUR = 60 * MIN
const KNEXT_PREFIX = 'mcp__K-Next__'
const CODE_TOOL = 'REPL'
const KNEXT_IN_CODE = /k[-_]?next/gi

type Options = {
  participant?: string
  webhookUrl?: string
  reportTime?: string
  utcOffsetHours?: number
}

function emptyStats(): DayStats {
  return {
    sessions: 0, prompts: 0, requests: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    modelToolUses: 0, knextModelCalls: 0, codeRuns: 0, knextInCode: 0,
    activeMs: 0, mismatchSessions: 0,
  }
}

async function localNow($: EngineInterface, offsetHours: number): Promise<{ day: string; hhmm: string }> {
  const iso = new Date((await $.clock.now()) + offsetHours * HOUR).toISOString()
  return { day: iso.slice(0, 10), hhmm: iso.slice(11, 16) }
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

/** 설치 파일이 등록한 매일 작업이 쓴 오늘 배정 (~/.claude/codemode-ab/assignment.json) */
async function readAssignment($: EngineInterface, day: string): Promise<Mode | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  try {
    const a = JSON.parse(await $.fs.read(`${home}/.claude/codemode-ab/assignment.json`)) as { date?: string; mode?: string }
    return a.date === day && (a.mode === 'on' || a.mode === 'off') ? a.mode : undefined
  } catch {
    return undefined
  }
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
                { title: '질문당 K-System 호출', value: `${per(s.knextModelCalls)} (코드 안 ${per(s.knextInCode)})` },
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

/** 보낸 뒤 숫자가 바뀐 날짜와 아직 안 보낸 날짜를 보낸다 (includeToday면 오늘 포함) */
async function sendPending($: EngineInterface, o: Options, today: string, includeToday: boolean) {
  const url = (o.webhookUrl ?? '').trim()
  if (!url) return { sent: 0, failed: 0, note: '웹훅 URL이 설정되지 않았습니다' }
  const participant = (o.participant ?? '').trim() || 'unknown'
  const days = ((await $.store.get('days')) as string[] | undefined) ?? []
  let sent = 0
  let failed = 0
  for (const entry of days) {
    const [d, m] = entry.split('|') as [string, Mode]
    if (d > today || (d === today && !includeToday)) continue
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
  const reportTime = /^\d{1,2}:\d{2}$/.test((o.reportTime ?? '').trim())
    ? (o.reportTime ?? '').trim().padStart(5, '0')
    : '16:55'
  let running: Mode = 'off'
  let humanTurn = false
  let turnDay = ''
  let promptAt = 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'ab-status', description: 'Code Mode 실험: 오늘 배정과 집계 보기' })
    await $.command.register({ name: 'ab-report', description: 'Code Mode 실험: 오늘까지의 결과를 지금 전송' })

    running = (await $.env.get('CLAUDE_CODE_EXPERIMENTAL_CODE_MODE')) === '1' ? 'on' : 'off'
    const { day } = await localNow($, offset)
    const assigned = await readAssignment($, day)
    const isMismatch = assigned !== undefined && assigned !== running
    await update($, mismatchAtom, () => (isMismatch && assigned ? { today: assigned, running } : null))
    await addStats($, day, running, { sessions: 1, mismatchSessions: isMismatch ? 1 : 0 })

    // 밀린 날짜는 시작할 때, 오늘 것은 매일 보고 시각에 보낸다
    await sendPending($, o, day, false)
    $.clock.every(MIN, () => {
      void (async () => {
        const now = await localNow($, offset)
        if (now.hhmm === reportTime) await sendPending($, o, now.day, true)
        else if (now.hhmm.endsWith(':00')) await sendPending($, o, now.day, false)
      })()
    })
    return result
  })

  on('session.end', async ($, e, next) => {
    // 종료할 때 보고 시각이 지났으면 오늘 것까지 한 번 더 보낸다 (그 사이 바뀐 숫자 반영)
    const now = await localNow($, offset)
    if (now.hhmm >= reportTime) await sendPending($, o, now.day, true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    humanTurn = kind === 'composer' || kind === 'bridge'
    if (humanTurn) {
      promptAt = await $.clock.now()
      turnDay = (await localNow($, offset)).day
      await addStats($, turnDay, running, { prompts: 1 })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (humanTurn && e.agentId === undefined && r.usage) {
      const names = r.toolUses.map(t => t.name)
      const codeInputs = r.toolUses.filter(t => t.name === CODE_TOOL).map(t => JSON.stringify(t.input ?? ''))
      await addStats($, turnDay, running, {
        requests: 1,
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheReadTokens: r.usage.cache_read_input_tokens,
        cacheWriteTokens: r.usage.cache_creation_input_tokens,
        modelToolUses: names.length,
        knextModelCalls: names.filter(n => n.startsWith(KNEXT_PREFIX)).length,
        codeRuns: codeInputs.length,
        knextInCode: codeInputs.reduce((n, c) => n + (c.match(KNEXT_IN_CODE)?.length ?? 0), 0),
      })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (humanTurn && e.agentId === undefined) {
      await addStats($, turnDay, running, { activeMs: (await $.clock.now()) - promptAt })
      humanTurn = false
    }
    return result
  })

  on('command.run', { command: 'ab-status' }, async $ => {
    const { day } = await localNow($, offset)
    const assigned = await readAssignment($, day)
    const label = (m: Mode | undefined) => (m === 'on' ? '켬' : m === 'off' ? '끔' : '아직 없음')
    const lines = [`오늘(${day}) 배정: ${label(assigned)} / 지금 실행 중: ${label(running)}`]
    if (assigned !== undefined && assigned !== running) lines.push('→ /exit 후 claude를 다시 실행하면 배정대로 바뀝니다.')
    for (const m of ['off', 'on'] as const) {
      const s = (await $.store.get(`stats:${day}|${m}`)) as DayStats | undefined
      if (s) lines.push(`오늘 ${label(m)}: 세션 ${s.sessions}, 질문 ${s.prompts}, 왕복 ${s.requests}, K-System ${s.knextModelCalls}, 코드 실행 ${s.codeRuns}(코드 안 K-System ${s.knextInCode})`)
    }
    lines.push(`참가자: ${(o.participant ?? '').trim() || '(미설정)'} / 전송: ${(o.webhookUrl ?? '').trim() ? `매일 ${reportTime}` : '미설정'}`)
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'ab-report' }, async $ => {
    const r = await sendPending($, o, (await localNow($, offset)).day, true)
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
