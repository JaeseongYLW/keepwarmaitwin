export type CacheInfo = {
  /** 마지막 메인 턴이 끝난 시각(ms) */
  lastActivityAt: number
  /** 다음 요청이 다시 보내는 프롬프트 토큰 수 */
  contextTokens: number
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    keepwarm: { cache: CacheInfo | null; footer: string }
  }
}
