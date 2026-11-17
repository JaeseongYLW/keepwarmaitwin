import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const URL_ = 'https://example.test/hook'
const SETTINGS = '/home/me/.claude/settings.json'
const USAGE = {
  input_tokens: 10, output_tokens: 200,
  cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1_000,
  model: 'claude-opus-5-5',
}

/** 엔진 쪽 흉내: 파일, 웹훅, 명령 등록 */
function engine(on: On, files: Record<string, string>) {
  const posts: { url: string; body: unknown }[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: '', usage: e.usage }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    const t = files[e.path]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.stat', (_, e) => {
    if (files[e.path] === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } as never }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    posts.push({ url: e.url, body: JSON.parse(String(e.init?.body)) })
    return { value: { status: 202, ok: true, headers: {}, text: '' } }
  })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '',
      toolUses: [
        { id: 'a', name: 'mcp__K-Next__find_screen', input: {} },
        { id: 'b', name: 'Read', input: {} },
      ],
      stopReason: 'tool_use',
      usage: USAGE,
    } as never
  })
  on('tool.call', () => ({ result: {} }) as never)
  return { posts }
}

const OPTS = { participant: '홍길동', webhookUrl: URL_ }

async function oneTurn($: any) {
  await $.prompt.submit({ text: '화면 찾아줘', wait: false, origin: { kind: 'composer' } })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
  for await (const _ of step) { /* drain */ }
  await $.tool.call({ tool: 'mcp__K-Next__find_screen' })
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, usage: USAGE })
}

test('첫 세션에서 오늘 모드를 정하고 settings.json env에 쓴다 (기존 설정 유지)', { options: OPTS }, async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 17, 1) })
  mock.store(on)
  mock.env(on, { USERPROFILE: '/home/me', CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '0' })
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ model: 'opus', env: { FOO: '1' } }) }
  engine(on, files)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const s = JSON.parse(files[SETTINGS]!)
  expect(s.model).toBe('opus')
  expect(s.env.FOO).toBe('1')
  expect(['0', '1']).toContain(s.env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE)

  const st = await $.command.run({ command: 'ab-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(st.text).toContain('2026-11-17')
})

test('지표를 모으고 다음 날 자동 전송, /ab-report는 오늘 것도 전송', { options: OPTS }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 17, 1) })
  mock.store(on, { 'assign:2026-11-17': 'on', 'assign:2026-11-18': 'off' })
  mock.env(on, { USERPROFILE: '/home/me', CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' })
  const w = engine(on, {})

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await oneTurn($)
  expect(w.posts.length).toBe(0) // 오늘 것은 아직 안 보냄

  const r = await $.command.run({ command: 'ab-report', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toContain('1건 전송')
  const body = w.posts[0]!.body as any
  expect(body.codemodeAb).toMatchObject({
    participant: '홍길동', day: '2026-11-17', mode: 'on',
    sessions: 1, prompts: 2, requests: 2, knextModelCalls: 2, knextExecuted: 2, modelToolUses: 4,
    cacheReadTokens: 100_000,
  })
  expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')

  // 변화가 없으면 다시 보내지 않고, 하루가 지나 새 질문이 생긴 날은 다음 날 1시간 주기에 보낸다
  const again = await $.command.run({ command: 'ab-report', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(again.text).toContain('새로 보낼 내용 없음')
  await oneTurn($)
  await clock.advance(24 * 3_600_000)
  expect(w.posts.length).toBe(2)
  expect((w.posts[1]!.body as any).codemodeAb.prompts).toBe(3)
})

test('배정과 다른 모드로 실행하면 불일치로 기록한다', { options: OPTS }, async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 17, 1) })
  mock.store(on, { 'assign:2026-11-17': 'on' })
  mock.env(on, { USERPROFILE: '/home/me' }) // 변수 없음 = 끔으로 실행
  const files: Record<string, string> = {}
  const w = engine(on, files)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files[SETTINGS]!).env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE).toBe('1')
  await oneTurn($)
  await $.command.run({ command: 'ab-report', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((w.posts[0]!.body as any).codemodeAb).toMatchObject({ mode: 'off', mismatchSessions: 1 })
})

test('자동 메시지(플러그인 ping 등)는 질문으로 세지 않는다', { options: OPTS }, async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 17, 1) })
  mock.store(on, { 'assign:2026-11-17': 'off' })
  mock.env(on, { USERPROFILE: '/home/me' })
  const w = engine(on, {})

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '[keepwarm] ping', wait: false, origin: { kind: 'plugin', name: 'keepwarm' } as never })
  await $.turn.complete({ reason: 'answer', turnId: 't0', answer: 'ok', durationMs: 1, isAborted: false, usage: USAGE })
  await oneTurn($)
  await $.command.run({ command: 'ab-report', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((w.posts[0]!.body as any).codemodeAb.prompts).toBe(1)
})
