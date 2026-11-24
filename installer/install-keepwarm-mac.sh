#!/bin/bash
# keepwarm 설치/업데이트 (macOS). Finder에서 더블클릭하거나 터미널에서 bash 로 실행합니다.
set -euo pipefail
NAME=keepwarm
PLUGIN_ZIP='__PLUGIN_ZIP_BASE64__'

echo ""
echo "=== keepwarm 설치/업데이트 (Mac) ==="

if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
  echo "Claude Code(claude 명령)를 찾지 못했습니다. Claude Code를 먼저 설치해 주세요."
  exit 1
fi

CLAUDE_DIR="$HOME/.claude"
MOD_DIR="$CLAUDE_DIR/mods/$NAME"
IS_UPDATE=0
[ -d "$MOD_DIR" ] && IS_UPDATE=1
rm -rf "$MOD_DIR"
mkdir -p "$MOD_DIR"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/keepwarm.XXXXXX")"
TMP_ZIP="$TMP_DIR/plugin.zip"
printf '%s' "$PLUGIN_ZIP" | base64 -d > "$TMP_ZIP" 2>/dev/null || printf '%s' "$PLUGIN_ZIP" | base64 -D > "$TMP_ZIP"
unzip -q -o "$TMP_ZIP" -d "$MOD_DIR"
rm -f "$TMP_ZIP"
rmdir "$TMP_DIR"
echo "모드 설치: $MOD_DIR"

# settings.json 의 env.CLAUDE_CODE_PLUGIN_DIRS 에 모드 경로 추가 (없을 때만, 백업 후)
SETTINGS="$CLAUDE_DIR/settings.json"
mkdir -p "$CLAUDE_DIR"
BAK=""
if [ -f "$SETTINGS" ]; then BAK="$SETTINGS.bak-$(date +%Y%m%d%H%M%S)-$$"; cp "$SETTINGS" "$BAK"; fi
if command -v python3 >/dev/null 2>&1 && python3 -c 'import json' >/dev/null 2>&1; then
  RESULT=$(python3 -I - "$SETTINGS" "$MOD_DIR" <<'PY'
import json, os, sys
path, mod = sys.argv[1], sys.argv[2]
s = {}
if os.path.exists(path) and open(path, encoding='utf-8').read().strip():
    s = json.load(open(path, encoding='utf-8'))
env = s.setdefault('env', {})
dirs = [d for d in env.get('CLAUDE_CODE_PLUGIN_DIRS', '').split(':') if d]
known = {mod, mod.rstrip('/'), '~/.claude/mods/keepwarm'}
if any(d.rstrip('/') in known for d in dirs):
    print('same')
else:
    env['CLAUDE_CODE_PLUGIN_DIRS'] = ':'.join(dirs + [mod])
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('added')
PY
)
else
  RESULT=$(osascript -l JavaScript - "$SETTINGS" "$MOD_DIR" <<'JXA'
ObjC.import('Foundation')
function run(argv) {
  const path = argv[0], mod = argv[1]
  const fm = $.NSFileManager.defaultManager
  let s = {}
  if (fm.fileExistsAtPath(path)) {
    const raw = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null))
    if (raw && raw.trim()) s = JSON.parse(raw)
  }
  s.env = s.env || {}
  const dirs = (s.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(':').filter(Boolean)
  const known = [mod, mod.replace(/\/$/, ''), '~/.claude/mods/keepwarm']
  if (dirs.some(d => known.includes(d.replace(/\/$/, '')))) return 'same'
  s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.concat([mod]).join(':')
  $(JSON.stringify(s, null, 2) + '\n').writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)
  return 'added'
}
JXA
)
fi
if [ "$RESULT" = "added" ]; then
  echo "설정 반영: $SETTINGS"
  [ -n "$BAK" ] && echo "  (기존 파일 백업: $BAK)"
else
  echo "설정: 이미 등록되어 있어 바꾸지 않았습니다."
  [ -n "$BAK" ] && rm -f "$BAK"
fi

echo ""
if [ "$IS_UPDATE" = 1 ]; then echo "업데이트가 끝났습니다."; else echo "설치가 끝났습니다."; fi
echo "열려 있는 Claude Code를 모두 종료하고 다시 실행하세요. /keepwarm 으로 상태를 볼 수 있습니다."
