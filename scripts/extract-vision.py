# 提取封面视觉特征：灰度缩略（16x6=96 维）+ 色相直方图（12 维）
# 输出 data/vision.json：{v:1, dim:108, data:{appid: base64(108 bytes)}}
import base64
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "data", "corpus.json")
OUT = os.path.join(ROOT, "data", "vision.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"}


def fetch(appid):
    url = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/capsule_231x87.jpg"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
        if len(raw) < 800:
            return None
        from io import BytesIO
        im = Image.open(BytesIO(raw)).convert("RGB")
        small = im.resize((16, 6), Image.LANCZOS)
        gray = bytes(int(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) for p in small.getdata())
        hsv = im.resize((24, 9), Image.LANCZOS).convert("HSV")
        hist = [0] * 12
        for h, s, v in hsv.getdata():
            if s < 30 or v < 25:
                continue
            hist[h * 12 // 256] += min(s, 255) // 8
        mx = max(hist) or 1
        hue = bytes(min(255, int(x * 255 / mx)) for x in hist)
        return appid, base64.b64encode(gray + hue).decode()
    except Exception:
        return None


def main():
    with open(CORPUS, "r", encoding="utf-8") as f:
        corpus = json.load(f)
    ids = [int(k) for k in corpus["games"].keys()]

    done = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as f:
                done = json.load(f).get("data", {})
        except Exception:
            done = {}
    todo = [i for i in ids if str(i) not in done]
    print(f"总数 {len(ids)}，已有 {len(done)}，待抓 {len(todo)}", flush=True)

    ok = 0
    with ThreadPoolExecutor(max_workers=24) as ex:
        futures = {ex.submit(fetch, i): i for i in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            if res:
                done[str(res[0])] = res[1]
                ok += 1
            if n % 500 == 0 or n == len(todo):
                with open(OUT, "w", encoding="utf-8") as f:
                    json.dump({"v": 1, "dim": 108, "data": done}, f)
                print(f"  {n}/{len(todo)} 成功 {ok}", flush=True)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "dim": 108, "data": done}, f)
    size = os.path.getsize(OUT) / 1024 / 1024
    print(f"完成：{len(done)} 款有封面特征，{size:.2f} MB", flush=True)


if __name__ == "__main__":
    main()
