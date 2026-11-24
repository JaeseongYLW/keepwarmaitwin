# AI-Twin keepwarm / Code Mode 검토 프로젝트

Claude Code의 캐시 유지(cache-tax), 사용 창 예약 시작(claude-keepwarm), Code Mode를 검토하고 테스트하는 프로젝트입니다.

| 경로 | 내용 |
| --- | --- |
| `mods/keepwarm/` | 캐시 유지 ping + 만료 비용 경고 + 사용 창 예약 시작 모드 |
| `mods/codemode-ab/` | Code Mode 실사용 비교 실험 모드 (하루 단위 배정, Teams 자동 전송) |
| `installer/` | 참가자용 설치 파일(.cmd 하나) 생성기 |
| `dist/keepwarm-install.cmd` | keepwarm 설치/업데이트 파일, Windows (더블클릭) |
| `dist/keepwarm-install-mac.command` | keepwarm 설치/업데이트 파일, Mac |
| `dist/keepwarm.plugin` | keepwarm 배포 패키지 (zip) |
| `docs/` | 보고 요약, 테스트 계획, Code Mode 설정, 실험 참가 안내 |

## 설치 파일 만들기 (Windows용 .cmd 하나, 다시 실행하면 업데이트)
```
python installer/build_installer.py keepwarm
python installer/build_installer.py keepwarm --mac
python installer/build_installer.py codemode-ab --webhook "<Teams 웹훅 URL>"
```
- `dist/keepwarm-install.cmd`: 비밀 값이 없어 저장소에 함께 올립니다.
- `dist/codemode-ab-install.cmd`: 웹훅 URL이 들어 있으므로 저장소에 올리지 말고(.gitignore 처리됨) 참가자에게 직접 전달하세요.

## Claude Code에서 마켓플레이스로 설치 (선택)
```
/plugin install keepwarm --marketplace JaeseongYLW/keepwarmaitwin
```

## 테스트
```
claude plugin test mods/keepwarm
claude plugin test mods/codemode-ab
```
