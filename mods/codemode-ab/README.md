# codemode-ab

Claude Code의 Code Mode를 실제 업무에서 켰을 때와 껐을 때를 비교하는 실험용 모드입니다.

- 하루 단위로 Code Mode 켬/끔을 50:50 무작위로 배정하고, `~/.claude/settings.json`의 `env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`에 써 둡니다. 다음 실행부터 적용됩니다.
- 사람이 입력한 질문 기준으로 API 왕복 수, 토큰(입력, 출력, 캐시 읽기, 캐시 쓰기), 도구 호출 수, K-System(MCP) 호출 수, Code Mode 코드 실행 수, 응답 시간을 모읍니다. 대화 내용은 저장하거나 보내지 않습니다.
- 지난 날짜의 집계를 Teams 웹훅으로 자동 전송합니다(세션 시작 시와 1시간마다). `/ab-report`는 오늘 것까지 바로 보냅니다.
- `/ab-status`로 오늘 배정과 집계를 볼 수 있습니다.

설정(`pluginConfigs.codemode-ab.options`): `participant`, `webhookUrl`, `manageSettings`(기본 true), `utcOffsetHours`(기본 9).
설치는 저장소의 `installer/`로 만든 설치 파일을 쓰세요.
