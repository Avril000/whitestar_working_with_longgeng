"""把字形元数据 JSON 转成网页能直接读取的 data.js

为什么要有这一步：
    浏览器直接打开本地网页时（file://），会因为安全策略拒绝读取 JSON 文件。
    所以先把 JSON 转成一个普通的 JS 文件，网页就能双击直接运行，不需要起服务器。

为什么图片要嵌进 data.js（base64）：
    1. 双击打开更彻底 —— 整个前端只需要 4 个文件，拷给组员不用带一整个图库文件夹
    2. 导出 PNG 必须这么做 —— file:// 打开的页面用 canvas 画本地图片属于「跨域污染」，
       toDataURL 会直接报 SecurityError；dataURI 不受此限制
    3. 按字去重 —— 同一个字可能有多条记录（不同页各出现一次），
       但页面上同字永远用同一张图，所以每字只嵌一张，556 字约 10MB

用法（在项目根目录下执行）：
    python tools/build_manifest.py
"""

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "metadata" / "glyphs.json"
BOOKS = ROOT / "data" / "metadata" / "books.json"
GOALS = ROOT / "data" / "goals.json"
IMGDIR = ROOT / "web" / "glyphs"
DST = ROOT / "web" / "data.js"


def pick_best(records):
    """同字多条记录时挑一条：已核对的优先，其次取第一条"""
    for r in records:
        if r.get("verified") == "已核对":
            return r
    return records[0]


def main():
    if not SRC.exists():
        print(f"找不到源文件：{SRC}")
        return

    data = json.loads(SRC.read_text(encoding="utf-8"))

    # 碑帖介绍从 books.json 读（merge_cards 写回去的 books 只有键名，
    # 缺 year/age/desc，页面上会显示不全）
    if BOOKS.exists():
        data["books"] = json.loads(BOOKS.read_text(encoding="utf-8"))

    glyphs = data.get("glyphs", [])

    # 简体 → 繁体异体映射（让前端输入简体也能找到碑里的繁体字）
    # goals.json 里的格式就是「简体: [繁体…]」，方向正好，直接透传
    if GOALS.exists():
        goals = json.loads(GOALS.read_text(encoding="utf-8"))
        data["variants"] = goals.get("variants", {})

    # 按字去重，挑出每个字要展示/导出的那张图，转成 base64 嵌入
    by_char = {}
    for g in glyphs:
        ch = g.get("char")
        if ch:
            by_char.setdefault(ch, []).append(g)

    glyph_img = {}
    missing_img = []
    for ch, records in by_char.items():
        rec = pick_best(records)
        gid = rec.get("id")
        if not gid:
            continue
        img = IMGDIR / f"{gid}.png"
        if img.exists():
            b64 = base64.b64encode(img.read_bytes()).decode("ascii")
            glyph_img[ch] = "data:image/png;base64," + b64
        else:
            missing_img.append(ch)

    data["glyph_img"] = glyph_img

    # 注意：web/glyphs/ 里的图由 make_webglyphs.py 从拓片源生成（透明底墨色字），
    # 本脚本只读取它，不覆盖、不同步。
    # 顺序：收卡片 → make_webglyphs（出图）→ build_manifest（出 data.js）

    lines = [
        "// 本文件由 tools/build_manifest.py 自动生成，请勿手工修改。",
        "// 要改数据，请改 data/metadata/glyphs.json，然后重新运行本脚本。",
        "window.DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";",
    ]
    DST.write_text("\n".join(lines) + "\n", encoding="utf-8")

    glyphs = data.get("glyphs", [])
    count = {}
    for g in glyphs:
        count[g.get("nature", "未知")] = count.get(g.get("nature", "未知"), 0) + 1

    print(f"已生成 {DST}（{DST.stat().st_size/1024/1024:.1f} MB）")
    print(f"字形记录：{len(glyphs)} 条，去重后嵌入图片：{len(glyph_img)} 字")
    if missing_img:
        print(f"缺图：{len(missing_img)} 字没有对应的 web/glyphs 图片，"
              f"先跑 python tools/make_webglyphs.py  → {missing_img[:10]}")
    for nature, n in count.items():
        print(f"  {nature}：{n} 条")


if __name__ == "__main__":
    main()
