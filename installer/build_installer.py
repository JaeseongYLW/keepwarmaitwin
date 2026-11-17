"""설치 파일(.cmd 하나) 만들기

사용: python installer/build_installer.py --webhook "<웹훅 URL>" [--out dist/codemode-ab-install.cmd]
웹훅 URL은 저장소에 커밋하지 않습니다. 만든 .cmd 파일만 참가자에게 전달하세요.
"""
import argparse
import base64
import io
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, 'mods', 'codemode-ab')
TEMPLATE = os.path.join(ROOT, 'installer', 'install-template.ps1')
SKIP_DIRS = {'.git', 'types'}  # .claude-plugin/types 는 엔진이 만드는 폴더


def plugin_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(MOD):
            rel = os.path.relpath(base, MOD)
            if rel.replace('\\', '/') == '.claude-plugin/types':
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if d != '.git' and not (rel == '.claude-plugin' and d == 'types')]
            for f in files:
                if f.endswith('.test.ts') or f == 'tsconfig.json':
                    continue
                p = os.path.join(base, f)
                z.write(p, os.path.relpath(p, MOD).replace(os.sep, '/'))
    # scripts/ 는 CRLF 그대로 담긴다 (Windows에서 실행)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--webhook', required=True)
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist', 'codemode-ab-install.cmd'))
    a = ap.parse_args()
    if "'" in a.webhook:
        raise SystemExit('웹훅 URL에 작은따옴표가 있으면 안 됩니다')
    text = open(TEMPLATE, encoding='utf-8').read()
    text = text.replace('__WEBHOOK_URL__', a.webhook).replace('__PLUGIN_ZIP_BASE64__', plugin_zip())
    text = text.replace('\r\n', '\n').replace('\n', '\r\n')  # cmd 는 CRLF 필요
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='') as f:  # BOM 없이 (cmd 첫 줄 보호)
        f.write(text)
    print(f'생성: {a.out}')


if __name__ == '__main__':
    main()
