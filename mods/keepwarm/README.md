# keepwarm

Claude Code 터미널 CLI용 모드입니다. 외부 도구 두 개(claude-keepwarm, cache-tax)가 하던 일을 하나로 합쳤습니다.

## 하는 일

1. **캐시 유지 ping** (cache-tax 대체)
   - 마지막 응답 후 50분(TTL 60분 - 10분)이 지나도록 입력이 없으면 짧은 ping 턴을 보내 프롬프트 캐시를 1시간 더 유지합니다.
   - 사용자가 입력하지 않는 동안 최대 3회까지만 보냅니다(기본값). 캐시가 이미 만료됐으면 보내지 않습니다.
   - ping은 대화에 "[keepwarm] ..." 메시지와 "ok" 응답으로 남습니다.
2. **캐시 만료 경고**
   - 캐시가 만료된 뒤 입력하면 다시 캐시하는 데 드는 예상 비용을 알림으로 보여 줍니다.
   - 상태 줄에 남은 캐시 시간과 컨텍스트 토큰 수를 표시합니다.
3. **5시간 사용 창 예약 시작** (claude-keepwarm 대체)
   - 지정한 시각(예: 07:00)에 가장 저렴한 모델로 아주 작은 요청을 보내 사용 창을 미리 시작합니다.
   - Claude Code 세션이 열려 있을 때만 동작합니다. PC가 꺼져 있거나 세션이 없으면 실행되지 않습니다.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `/keepwarm` 또는 `/keepwarm status` | 현재 상태, 남은 캐시 시간, ping 1회와 재캐시 예상 비용 |
| `/keepwarm on` / `/keepwarm off` | 이 세션에서 캐시 유지 ping 켜기/끄기 |
| `/keepwarm ping` | 지금 ping 한 번 보내기 |
| `/keepwarm window` | 지금 사용 창 시작 요청 보내기 |

## 설정 (`/config` 또는 `~/.claude/settings.json`의 `pluginConfigs.keepwarm`)

| 항목 | 기본값 | 설명 |
| --- | --- | --- |
| cacheKeepalive | true | 캐시 유지 ping 사용 여부 |
| cacheTtlMinutes | 60 | 캐시 TTL(분). 5분 TTL 환경이면 5 |
| pingLeadMinutes | 10 | 만료 몇 분 전에 ping할지 |
| maxPings | 3 | 입력 없이 연속으로 보낼 ping 최대 횟수(0이면 끔) |
| inputPricePerMTok | 5 | 비용 추정용 기본 입력 단가($/백만 토큰). 쓰는 모델 단가로 바꾸세요 |
| windowStartTimes | (비어 있음) | 사용 창 시작 시각, 예: `07:00,12:00` |
| windowModel | haiku | 사용 창 시작에 쓸 모델 |
| utcOffsetHours | 9 | 시간대(한국 9) |

## 비용 추정 방식

- 캐시 쓰기 = 기본 단가 x 2 (TTL 60분) 또는 x 1.25 (TTL 5분)
- 캐시 읽기(ping 1회) = 기본 단가 x 0.1
- 구독 요금제에서는 금액이 청구되지 않고 사용 한도가 차감됩니다. 표시되는 금액은 비교용 추정치입니다.

## 설치 (로컬 터미널 CLI)

1. `keepwarm.plugin` 파일의 압축을 풀어 `~/.claude/mods/keepwarm/` 폴더에 둡니다(`.claude-plugin` 폴더가 그 바로 아래에 있어야 합니다).
2. 한 번만 쓸 때: `claude --plugin-dir ~/.claude/mods/keepwarm`
3. 항상 켜 두기: `~/.claude/settings.json`에 아래를 추가합니다.

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/keepwarm" } }
```

## 주의

- Anthropic 공식 기능이 아니라 Claude Code 모드(플러그인) API로 만든 사내 도구입니다.
- ping과 사용 창 시작은 실제 요청이라 사용량을 소모합니다. 오래 쉬었다가 같은 세션을 이어 쓸 때만 이득이 있습니다.
