"""설치/업데이트 파일(.cmd 하나) 만들기

사용:
  python installer/build_installer.py keepwarm
      -> dist/keepwarm-install.cmd (비밀 값 없음, 저장소에 올려도 됨)
  python installer/build_installer.py codemode-ab --webhook "<웹훅 URL>"
      -> dist/codemode-ab-install.cmd (웹훅 URL 포함, 저장소에 올리지 말 것)
같은 파일을 다시 실행하면 덮어써서 업데이트됩니다.
"""
import argparse
import base64
import io
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def plugin_zip(mod):
    base_dir = os.path.join(ROOT, 'mods', mod)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(base_dir):
            rel = os.path.relpath(base, base_dir).replace(os.sep, '/')
            dirs[:] = sorted(d for d in dirs if d != '.git' and not (rel == '.claude-plugin' and d == 'types'))
            for f in sorted(files):
                if '.test.' in f or f == 'tsconfig.json':
                    continue
                p = os.path.join(base, f)
                z.write(p, os.path.relpath(p, base_dir).replace(os.sep, '/'))
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mod', choices=['keepwarm', 'codemode-ab'])
    ap.add_argument('--webhook')
    ap.add_argument('--out')
    a = ap.parse_args()
    text = open(os.path.join(ROOT, 'installer', f'install-{a.mod}.ps1'), encoding='utf-8').read()
    if '__WEBHOOK_URL__' in text:
        if not a.webhook:
            raise SystemExit('--webhook 이 필요합니다')
        if "'" in a.webhook:
            raise SystemExit('웹훅 URL에 작은따옴표가 있으면 안 됩니다')
        text = text.replace('__WEBHOOK_URL__', a.webhook)
    text = text.replace('__PLUGIN_ZIP_BASE64__', plugin_zip(a.mod))
    text = text.replace('\r\n', '\n').replace('\n', '\r\n')  # cmd 는 CRLF 필요
    out = a.out or os.path.join(ROOT, 'dist', f'{a.mod}-install.cmd')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='') as f:  # BOM 없이 (cmd 첫 줄 보호)
        f.write(text)
    print(f'생성: {out}')


if __name__ == '__main__':
    main()
