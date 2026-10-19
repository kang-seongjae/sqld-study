"""정해진 화면들을 스크린샷으로 찍는다: python tests/shots.py <이름>

screenshots/<이름>/ 에 저장하고, screenshots/before 와 screenshots/after 가 둘 다 있으면
두 폴더를 나란히 비교하는 screenshots/compare.html 을 만든다(디자인을 바꿀 때 전후 비교용).
screenshots/ 폴더는 git에 올리지 않는다.
"""
import json
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_tests import ROOT, chrome, find_chrome  # noqa: E402
from serve import make_server  # noqa: E402

# (파일 이름, 너비, 높이, 탭, 처음 열 카드 위치 또는 None=기본)
SQL_CARD = {"subject": 1, "unit": 1, "card": 2}  # 2과목 > SELECT 기본과 WHERE 조건 > 별칭(오라클 차이 있음)
VIEWS = [
    ("laptop-card-sql", 1440, 900, "cards", SQL_CARD),
    ("laptop-card-model", 1440, 900, "cards", None),
    ("laptop-quiz", 1440, 900, "quiz", None),
    ("phone-card", 390, 844, "cards", SQL_CARD),
    ("phone-quiz", 390, 844, "quiz", None),
]


def take(label, base, exe):
    out = ROOT / "screenshots" / label
    out.mkdir(parents=True, exist_ok=True)
    for name, w, h, tab, ui in VIEWS:
        url = f"{base}/tests/frame.html?w={w}&h={h}&hash={tab}"
        if ui:
            url += "&ui=" + json.dumps(ui, separators=(",", ":"))
        with tempfile.TemporaryDirectory() as profile:
            chrome(exe, profile, f"--window-size={w},{h}", "--hide-scrollbars", "--virtual-time-budget=15000",
                   f"--screenshot={out / (name + '.png')}", url)
        print(f"  screenshots/{label}/{name}.png  ({w}x{h})")


def write_compare():
    shots = ROOT / "screenshots"
    if not ((shots / "before").is_dir() and (shots / "after").is_dir()):
        return
    rows = "\n".join(
        f"<h2>{name} ({w}×{h})</h2><div class=row>"
        f"<figure><figcaption>전</figcaption><img src='before/{name}.png'></figure>"
        f"<figure><figcaption>후</figcaption><img src='after/{name}.png'></figure></div>"
        for name, w, h, _, _ in VIEWS)
    (shots / "compare.html").write_text(f"""<!doctype html><meta charset=utf-8><title>디자인 전후 비교</title>
<style>body{{font-family:system-ui,sans-serif;margin:16px;background:#f4f4f4}}
.row{{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}}figure{{margin:0}}
img{{max-width:46vw;border:1px solid #999}}figcaption{{font-weight:700;margin-bottom:4px}}</style>
<h1>디자인 전후 비교</h1>{rows}""", encoding="utf-8")
    print("  screenshots/compare.html")


if __name__ == "__main__":
    label = sys.argv[1] if len(sys.argv) > 1 else "latest"
    server = make_server(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        take(label, f"http://127.0.0.1:{server.server_address[1]}", find_chrome())
    finally:
        server.shutdown()
    write_compare()
