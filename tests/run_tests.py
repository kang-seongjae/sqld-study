"""테스트 실행: python tests/run_tests.py [--shots]

1. 정적 검사: sw.js의 ASSETS가 앱 파일과 맞는지, 앱 파일을 바꿨는데 VERSION을 안 올렸는지
2. 브라우저 테스트: 헤드리스 Chrome으로 tests/test.html을 열어 결과를 읽음
3. --shots: 노트북 너비(1440)·폰 너비(390) 스크린샷을 screenshots/에 저장

필요한 것: Python 3, Chrome 또는 Edge (경로가 다르면 CHROME 환경 변수로 지정)
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from serve import make_server  # noqa: E402

# 앱에 속한 파일: 바뀌면 오프라인 캐시도 바뀌어야 하는 것들
APP_GLOBS = ["*.html", "*.css", "*.js", "*.webmanifest", "*.svg", "lib/**/*", "data/**/*.json", "vendor/**/*.js", "vendor/**/*.wasm", "fonts/**/*.ttf"]
NOT_APP = {"sw.js"}

CHROME_CANDIDATES = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def sw_info(text):
    version = re.search(r"const VERSION = '([^']+)'", text)
    assets = re.search(r"const ASSETS = \[(.*?)\];", text, re.S)
    return (
        version.group(1) if version else None,
        re.findall(r"'([^']+)'", assets.group(1)) if assets else [],
    )


def app_files():
    files = set()
    for pattern in APP_GLOBS:
        for p in ROOT.glob(pattern):
            if p.is_file():
                rel = p.relative_to(ROOT).as_posix()
                if rel not in NOT_APP:
                    files.add(rel)
    return files


def check_assets():
    version, assets = sw_info((ROOT / "sw.js").read_text(encoding="utf-8"))
    errors = []
    if not version:
        errors.append("sw.js에서 VERSION을 찾지 못함")
    listed = {a for a in assets if a != "./"}
    for a in sorted(listed - app_files()):
        errors.append(f"sw.js ASSETS에 있는데 파일이 없음: {a}")
    for a in sorted(app_files() - listed):
        errors.append(f"앱 파일인데 sw.js ASSETS에 없음(오프라인에서 안 열림): {a}")
    return errors


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")


def check_version_bump():
    """마지막 커밋 이후 앱 파일이 바뀌었는데 VERSION이 그대로면 실패."""
    head = git("show", "HEAD:sw.js")
    if head.returncode != 0:
        return [], "첫 커밋 전이라 건너뜀"
    old_version, _ = sw_info(head.stdout)
    new_version, _ = sw_info((ROOT / "sw.js").read_text(encoding="utf-8"))
    changed = set(git("diff", "--name-only", "HEAD").stdout.split())
    changed |= set(git("ls-files", "--others", "--exclude-standard").stdout.split())
    touched = sorted(changed & app_files())
    if touched and old_version == new_version:
        return [f"앱 파일이 바뀌었는데 sw.js VERSION이 '{new_version}' 그대로예요: {', '.join(touched)}"], None
    return [], None


def find_chrome():
    for c in CHROME_CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.exit("Chrome/Edge를 찾지 못했어요. CHROME 환경 변수에 실행 파일 경로를 넣어 주세요.")


def chrome(exe, profile, *args, timeout=120):
    cmd = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
           f"--user-data-dir={profile}", *args]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def run_browser_tests(exe, base):
    with tempfile.TemporaryDirectory() as profile:
        r = chrome(exe, profile, "--virtual-time-budget=60000", "--dump-dom", f"{base}/tests/test.html")
    m = re.search(r'<pre id="out" data-status="(\w+)">(.*?)</pre>', r.stdout, re.S)
    if not m:
        return False, "테스트 페이지 결과를 읽지 못함\n" + r.stdout[-2000:] + r.stderr[-2000:]
    return m.group(1) == "pass", html.unescape(m.group(2))


def take_screenshots(exe, base):
    out = ROOT / "screenshots"
    out.mkdir(exist_ok=True)
    shots = [
        ("laptop-cards.png", 1440, 900, "cards"),
        ("laptop-quiz.png", 1440, 900, "quiz"),
        ("phone-cards.png", 390, 844, "cards"),
        ("phone-full.png", 390, 1750, "cards"),
    ]
    for name, w, h, tab in shots:
        # 헤드리스 창은 500px보다 좁아지지 않으므로 좁은 화면은 그 너비의 iframe 안에서 연다.
        url = f"{base}/index.html?ns=shot#{tab}" if w >= 500 else f"{base}/tests/frame.html?w={w}&h={h}&hash={tab}"
        with tempfile.TemporaryDirectory() as profile:
            chrome(exe, profile, f"--window-size={w},{h}", "--hide-scrollbars", "--virtual-time-budget=15000",
                   f"--screenshot={out / name}", url)
        print(f"  screenshots/{name}  ({w}x{h})")


def main():
    ok = True
    print("[정적 검사]")
    errors = check_assets()
    bump_errors, skipped = check_version_bump()
    errors += bump_errors
    for e in errors:
        print(f"  FAIL {e}")
    print(f"  sw.js ASSETS 검사 {'통과' if not check_assets() else '실패'}")
    print(f"  VERSION 올림 검사 {skipped or ('실패' if bump_errors else '통과')}")
    ok &= not errors

    server = make_server(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    exe = find_chrome()
    try:
        print("[브라우저 테스트]")
        passed, report = run_browser_tests(exe, base)
        print("  " + report.replace("\n", "\n  "))
        ok &= passed
        if "--shots" in sys.argv:
            print("[스크린샷]")
            take_screenshots(exe, base)
    finally:
        server.shutdown()

    print("\n모두 통과" if ok else "\n실패한 항목이 있어요")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
