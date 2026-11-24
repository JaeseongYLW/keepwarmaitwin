import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000

const USAGE = {
  input_tokens: 10,
  output_tokens: 90,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
}

/** 엔진 쪽 동작을 흉내내는 훅들. 보낸 프롬프트와 토스트를 기록한다. */
function engine(on: On) {
  const all: string[] = []
  const prompts = { get length() { return all.filter(t => t.includes('[keepwarm]')).length }, at: (i: number) => all.filter(t => t.includes('[keepwarm]'))[i] }
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'keepwarm' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    all.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: '', usage: e.usage }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return { prompts, toasts, statuses }
}

test('쉬는 동안 50분 뒤 ping을 보내고, 최대 횟수를 넘기지 않는다', { options: { maxPings: 2 } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const w = engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '작업해줘', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, usage: USAGE })

  await clock.advance(49 * MIN)
  expect(w.prompts.length).toBe(0)
  await clock.advance(1 * MIN)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts.at(0)).toContain('[keepwarm]')

  // ping 턴이 끝나면 다음 ping이 예약된다
  await $.turn.complete({ reason: 'answer', turnId: 't2', answer: 'ok', durationMs: 1000, isAborted: false, usage: USAGE })
  await clock.advance(50 * MIN)
  expect(w.prompts.length).toBe(2)
  await $.turn.complete({ reason: 'answer', turnId: 't3', answer: 'ok', durationMs: 1000, isAborted: false, usage: USAGE })
  await clock.advance(50 * MIN)
  expect(w.prompts.length).toBe(2) // maxPings=2
})

test('ping을 끄면 만료 후 입력할 때 재캐시 비용을 경고한다', { options: { cacheKeepalive: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const w = engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '작업해줘', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, usage: USAGE })

  await clock.advance(70 * MIN)
  expect(w.prompts.length).toBe(0) // ping 없음
  await $.prompt.submit({ text: '다시 왔어', wait: false, origin: { kind: 'composer' } })
  const warn = w.toasts.find(t => t.includes('만료'))
  expect(warn).toBeDefined()
  // 100k 토큰 * $5/MTok * 2 = $1.00
  expect(warn).toContain('$1.00')
})

test('/keepwarm status가 남은 시간과 예상 비용을 보여준다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '작업해줘', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, usage: USAGE })
  await clock.advance(20 * MIN)

  const r = await $.command.run({ command: 'keepwarm', args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toContain('40분 남음')
  expect(r.text).toContain('ping 1회 예상: $0.05')
})

test('예약 시각에 사용 창 시작 요청을 하루 한 번 보낸다', { options: { windowStartTimes: '07:00' } }, async ($, on) => {
  // 2026-11-16 06:58 KST = 2026-11-15 21:58 UTC
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 15, 21, 58) })
  mock.store(on)
  engine(on)
  const calls: string[] = []
  on('model.complete', (_, e) => {
    calls.push(e.model)
    return { value: { isAnswered: true, text: 'h', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1 * MIN)
  expect(calls.length).toBe(0)
  await clock.advance(1 * MIN) // 07:00
  expect(calls).toEqual(['haiku'])
  await clock.advance(5 * MIN)
  expect(calls.length).toBe(1)
})

/** 테스트가 엔진 대신 그리는 행: 받은 props를 글자로 보여 준다 */
function engineRows(on: On) {
  for (const component of ['SessionMode', 'UserMessage', 'AssistantMessage'] as const) {
    on('ui.render', { component }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      const p = e.props as { modes?: readonly string[]; text?: string }
      return <Text>{p.modes ? p.modes.join(' & ') : p.text}</Text>
    })
  }
}

test('상태는 모드 표시줄에 예상 비용과 함께 붙는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on)
  engineRows(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '작업해줘', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, usage: { ...USAGE, cache_read_input_tokens: 326_000 } })
  await clock.advance(MIN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    const t = await ui.find({ type: 'Text' })
    expect(t?.text).toContain('focus & 캐시 59분 남음 · 326k tok · $3.26 (예측값)')
    expect(t?.text).not.toContain('🔥')
    await ui.unmount()
  }
})

test('ping 질문과 답은 평소 화면에서 숨고 전체 보기에서는 보인다', async ($, on) => {
  engine(on)
  engineRows(on)
  const ping = { text: '[keepwarm] cache ping. Reply only: keepwarm-ok', origin: { kind: 'plugin', name: 'keepwarm' } as never }
  for (const surface of ['terminal', 'desktop'] as const) {
    const hidden = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'UserMessage', props: { ...ping, isExpanded: false } })
    expect(await hidden.find({ type: 'Text' })).toBeUndefined()
    await hidden.unmount()

    const shown = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'UserMessage', props: { ...ping, isExpanded: true } })
    expect((await shown.find({ type: 'Text' }))?.text).toContain('[keepwarm]')
    await shown.unmount()

    const reply = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'AssistantMessage', props: { text: 'keepwarm-ok', isFirstOfReply: true } })
    expect(await reply.find({ type: 'Text' })).toBeUndefined()
    await reply.unmount()

    const normal = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'AssistantMessage', props: { text: 'ok', isFirstOfReply: true } })
    expect((await normal.find({ type: 'Text' }))?.text).toBe('ok')
    await normal.unmount()

    const human = await $.ui.mount({ plugin: 'keepwarm', surface, component: 'UserMessage', props: { text: '[keepwarm] 이거 뭐야?', origin: { kind: 'composer' }, isExpanded: false } })
    expect((await human.find({ type: 'Text' }))?.text).toContain('이거 뭐야')
    await human.unmount()
  }
})
