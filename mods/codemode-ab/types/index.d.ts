export type Mode = 'on' | 'off'

export type DayStats = {
  sessions: number
  prompts: number
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 모델이 직접 요청한 도구 호출 수 */
  modelToolUses: number
  /** 모델이 직접 요청한 K-System(MCP) 호출 수 */
  knextModelCalls: number
  /** Code Mode 코드 실행(REPL) 횟수 */
  codeRuns: number
  /** 실제로 실행된 도구 호출 수 (Code Mode 코드 안의 호출 포함 여부 확인용) */
  executedToolCalls: number
  /** 실제로 실행된 K-System 호출 수 */
  knextExecuted: number
  /** 질문부터 그 턴이 끝날 때까지 시간의 합(ms) */
  activeMs: number
  /** 배정과 다른 모드로 실행된 세션 수 */
  mismatchSessions: number
}

declare module 'claude-code' {
  interface PluginState {
    'codemode-ab': { mismatch: { today: Mode; running: Mode } | null }
  }
}
