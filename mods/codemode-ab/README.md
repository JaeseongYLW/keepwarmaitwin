# codemode-ab

Claude Code의 Code Mode를 실제 업무에서 켰을 때와 껐을 때를 비교하는 실험용 모드입니다.

설치:

```
/plugin install codemode-ab --marketplace JaeseongYLW/keepwarmaitwin
```

참가자에게는 저장소의 `installer/`로 만든 설치 파일(.cmd 하나)을 쓰세요. 매일 배정 작업과 전송 설정까지 한 번에 넣습니다.

- **배정:** 설치 파일이 등록한 Windows 작업(`codemode-ab-daily`, 매일 06:00과 로그인 때)이 그날 Code Mode 켬/끔을 50:50으로 정합니다. 결과는 `~/.claude/settings.json`의 env와 `~/.claude/codemode-ab/assignment.json`에 씁니다. 모드는 설정을 쓰지 않고 읽기만 합니다.
- **기록:** 사람이 입력한 질문 기준으로 API 왕복 수, 토큰(입력, 출력, 캐시 읽기, 캐시 쓰기), 모델이 요청한 도구 호출과 K-System(MCP) 호출 수, Code Mode 코드 실행 수와 코드 안 K-System 언급 수, 응답 시간을 모읍니다. 대화 내용은 저장하거나 보내지 않습니다.
- **전송:** 매일 16:55(`reportTime`)에 Claude Code가 켜져 있으면 오늘 결과를 Teams 웹훅으로 보냅니다. 밀린 날짜는 다음 실행 때 보내고, 종료할 때 16:55가 지났으면 바뀐 숫자를 한 번 더 보냅니다. 같은 날짜 카드가 여러 번 오면 마지막 것을 쓰세요.
- **명령:** `/ab-status`로 오늘 배정과 집계를 보고, `/ab-report`로 지금 바로 보냅니다.
- **제약:** Code Mode는 도구 호출을 검사하는 훅(`tool.call` 등)을 가진 모드가 있으면 켜지지 않습니다. 그래서 이 모드는 그런 훅을 쓰지 않습니다. 그 결과 Code Mode 코드 안에서 실행된 개별 호출은 직접 세지 못하고, 코드 본문에서 찾은 언급 수로 추정합니다.

설정(`pluginConfigs.codemode-ab.options`): `participant`, `webhookUrl`, `reportTime`(기본 16:55), `utcOffsetHours`(기본 9).
제거: `%USERPROFILE%\.claude\mods\codemode-ab\scripts\uninstall.cmd`
