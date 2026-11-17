import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheInfo } from '../types'

const cacheAtom = atom({ plugin: 'keepwarm', key: 'cache' } as const, null as CacheInfo | null)

const MIN = 60_000
const PING_TEXT =
  '[keepwarm] 프롬프트 캐시 유지용 자동 ping입니다. 도구를 쓰지 말고 "ok" 한 단어만 답하세요.'

type Options = {
  cacheKeepalive?: boolean
  cacheTtlMinutes?: number
  pingLeadMinutes?: number
  maxPings?: number
  inputPricePerMTok?: number
  windowStartTimes?: string
  windowModel?: string
  utcOffsetHours?: number
}

function usd(n: number): string {
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

function tok(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** "07:00, 12:30" -> ["07:00","12:30"] (형식이 틀린 값은 버림) */
function parseTimes(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d{1,2}:\d{2}$/.test(s))
    .map(s => s.padStart(5, '0'))
}

async function startWindow($: EngineInterface, model: string, label: string) {
  const r = await $.model.complete({ model, prompt: 'hi', maxTokens: 1 })
  if (r.isAnswered) {
    $.ui.toast(`keepwarm: 5시간 사용 창을 시작했습니다 (${label}, ${model})`)
  } else {
    $.ui.toast(`keepwarm: 사용 창 시작 요청 실패 (${r.reason})`)
  }
  return r
}

export const register: Register = (on, options) => {
  const o = (options ?? {}) as Options
  const ttlMin = Math.max(1, Number(o.cacheTtlMinutes ?? 60))
  const leadMin = Math.min(ttlMin - 0.5, Math.max(0.5, Number(o.pingLeadMinutes ?? 10)))
  const maxPings = Math.max(0, Math.floor(Number(o.maxPings ?? 3)))
  const basePrice = Number(o.inputPricePerMTok ?? 5)
  const writeMult = ttlMin >= 60 ? 2 : 1.25
  const windowTimes = parseTimes(o.windowStartTimes ?? '')
  const windowModel = (o.windowModel ?? 'haiku').trim() || 'haiku'
  const offsetMs = Number(o.utcOffsetHours ?? 9) * 60 * MIN

  // 모듈 변수: 리로드 때 초기화됨 (지속 값은 $.state / $.store)
  let enabled = o.cacheKeepalive !== false
  let busy = false
  let pingsSinceUser = 0
  let pingPending = false
  let pingTimer: { cancel: () => void } | undefined
  let statusTimer: { cancel: () => void } | undefined
  let windowTimer: { cancel: () => void } | undefined

  const reCacheCost = (tokens: number) => (tokens / 1e6) * basePrice * writeMult
  const pingCost = (tokens: number) => (tokens / 1e6) * basePrice * 0.1

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.command.register({
      name: 'keepwarm',
      description: 'keepwarm 상태/제어: status | on | off | ping | window',
    })

    const showStatus = async () => {
      const c = await read($, cacheAtom)
      if (c === null) return $.ui.status(undefined)
      const left = c.lastActivityAt + ttlMin * MIN - (await $.clock.now())
      const head = left > 0 ? `캐시 ${Math.ceil(left / MIN)}분 남음` : '캐시 만료됨'
      $.ui.status(`🔥 ${head} · ${tok(c.contextTokens)} tok${enabled ? '' : ' · ping 꺼짐'}`)
    }

    const sendPing = async () => {
      pingTimer = undefined
      if (!enabled || busy || pingsSinceUser >= maxPings) return
      const c = await read($, cacheAtom)
      if (c === null) return
      // 이미 만료됐으면 ping해도 캐시를 새로 쓰는 비용만 들므로 보내지 않음
      if ((await $.clock.now()) - c.lastActivityAt >= ttlMin * MIN) return
      pingPending = true
      pingsSinceUser += 1
      await $.prompt.submit({ text: PING_TEXT })
    }

    const schedulePing = (_c: CacheInfo) => {
      pingTimer?.cancel()
      pingTimer = undefined
      if (!enabled || maxPings === 0) return
      const delay = Math.max(MIN / 2, (ttlMin - leadMin) * MIN)
      pingTimer = $.clock.after(delay, () => {
        void sendPing()
      })
    }

    // 상태 줄은 1분마다 갱신
    statusTimer?.cancel()
    statusTimer = $.clock.every(MIN, () => {
      void showStatus()
    })

    // 5시간 사용 창 예약 시작: 1분마다 현지 시각(HH:MM)을 확인
    windowTimer?.cancel()
    if (windowTimes.length > 0) {
      windowTimer = $.clock.every(MIN, () => {
        void (async () => {
          const local = new Date((await $.clock.now()) + offsetMs)
          const hhmm = local.toISOString().slice(11, 16)
          const day = local.toISOString().slice(0, 10)
          if (!windowTimes.includes(hhmm)) return
          const key = `window:${day}:${hhmm}`
          if ((await $.store.get(key)) !== undefined) return // 같은 슬롯은 하루 한 번
          await $.store.set(key, true)
          await startWindow($, windowModel, `${day} ${hhmm}`)
        })()
      })
    }

    // 다른 훅에서 쓰도록 보관
    hooks.schedulePing = schedulePing
    hooks.sendPing = sendPing
    hooks.showStatus = showStatus

    const c = await read($, cacheAtom)
    if (c !== null) schedulePing(c)
    await showStatus()

    return result
  })

  const hooks: {
    schedulePing?: (c: CacheInfo) => void
    sendPing?: () => Promise<void>
    showStatus?: () => Promise<void>
  } = {}

  on('prompt.submit', async ($, e, next) => {
    const isOurPing = e.origin?.kind === 'plugin' && pingPending
    if (!isOurPing) {
      // 사람이 보낸 입력: 캐시가 이미 만료됐으면 재캐시 예상 비용을 알려줌
      pingsSinceUser = 0
      const c = await read($, cacheAtom)
      if (c !== null) {
        const idle = (await $.clock.now()) - c.lastActivityAt
        if (idle >= ttlMin * MIN && c.contextTokens > 0) {
          $.ui.toast(
            `keepwarm: ${Math.round(idle / MIN)}분 쉬어 캐시가 만료됐습니다. ` +
              `${tok(c.contextTokens)} 토큰 재캐시 예상 ${usd(reCacheCost(c.contextTokens))}`,
            { timeoutMs: 8000 },
          )
        }
      }
    }
    pingPending = false
    busy = true
    pingTimer?.cancel()
    pingTimer = undefined
    return next(e)
  }).catch(($, e, next) => next(e)) // 이 모드가 실패해도 사용자 입력은 막지 않음

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result // 서브에이전트 턴은 무시
    busy = false
    const u = e.usage
    if (u !== undefined && e.reason !== 'error') {
      const contextTokens =
        u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      const info: CacheInfo = {
        lastActivityAt: await $.clock.now(),
        contextTokens,
        model: u.model,
      }
      await update($, cacheAtom, () => info)
      hooks.schedulePing?.(info)
    }
    await hooks.showStatus?.()
    return result
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const c = await read($, cacheAtom)

    if (arg === 'off') {
      enabled = false
      pingTimer?.cancel()
      pingTimer = undefined
      await hooks.showStatus?.()
      return { text: 'keepwarm: 캐시 유지 ping을 껐습니다 (이 세션에서만).' }
    }
    if (arg === 'on') {
      enabled = true
      if (c !== null) hooks.schedulePing?.(c)
      await hooks.showStatus?.()
      return { text: 'keepwarm: 캐시 유지 ping을 켰습니다.' }
    }
    if (arg === 'ping') {
      if (c === null) return { text: 'keepwarm: 아직 끝난 턴이 없어 유지할 캐시가 없습니다.' }
      pingPending = true
      await $.prompt.submit({ text: PING_TEXT })
      return { text: 'keepwarm: ping을 보냈습니다.' }
    }
    if (arg === 'window') {
      const r = await startWindow($, windowModel, '수동')
      return { text: r.isAnswered ? 'keepwarm: 사용 창 시작 요청을 보냈습니다.' : `keepwarm: 실패 (${r.reason})` }
    }

    const lines = [
      `캐시 유지 ping: ${enabled ? '켜짐' : '꺼짐'} (TTL ${ttlMin}분, 만료 ${leadMin}분 전 ping, 최대 ${maxPings}회)`,
    ]
    if (c === null) {
      lines.push('캐시 정보: 아직 끝난 턴이 없음')
    } else {
      const left = c.lastActivityAt + ttlMin * MIN - (await $.clock.now())
      lines.push(
        `캐시 정보: ${tok(c.contextTokens)} 토큰, ${left > 0 ? `${Math.ceil(left / MIN)}분 남음` : '만료됨'} (${c.model})`,
        `ping 1회 예상: ${usd(pingCost(c.contextTokens))} · 만료 후 재캐시 예상: ${usd(reCacheCost(c.contextTokens))}`,
        `이번 휴식 중 보낸 ping: ${pingsSinceUser}/${maxPings}`,
      )
    }
    lines.push(
      `사용 창 예약: ${windowTimes.length ? windowTimes.join(', ') + ` (UTC${offsetMs >= 0 ? '+' : ''}${offsetMs / 60 / MIN}, ${windowModel})` : '없음'}`,
      '명령: /keepwarm status | on | off | ping | window',
    )
    return { text: lines.join('\n') }
  })
}
