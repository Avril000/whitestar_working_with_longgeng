"""把字形元数据 JSON 转成网页能直接读取的 data.js

为什么要有这一步：
    浏览器直接打开本地网页时（file://），会因为安全策略拒绝读取 JSON 文件。
    所以先把 JSON 转成一个普通的 JS 文件，网页就能双击直接运行，不需要起服务器。

为什么图片要嵌进 data.js（base64）：
    1. 双击打开更彻底 —— 整个前端只需要 4 个文件，拷给组员不用带一整个图库文件夹
    2. 导出 PNG 必须这么做 —— file:// 打开的页面用 canvas 画本地图片属于「跨域污染」，
       toDataURL 会直接报 SecurityError；dataURI 不受此限制
    3. 每个版本都嵌 —— 同一个字可能有好几种写法（如「之」有 22 版），
       多版本切换功能要求每个版本都有自己的图，所以按 id 逐条嵌。
       字形图是调色板 PNG（约 1.9KB/张），全部版本嵌完仍然只有几 MB

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
    recs_by_id = {g.get("id"): g for g in glyphs if g.get("id")}

    # 简体 → 繁体异体映射（让前端输入简体也能找到碑里的繁体字）
    # goals.json 里的格式就是「简体: [繁体…]」，方向正好，直接透传
    if GOALS.exists():
        goals = json.loads(GOALS.read_text(encoding="utf-8"))
        data["variants"] = goals.get("variants", {})

    # 【2026-10-21 改】多版本切换：同一个字可能有好几种写法（如「之」有 22 版），
    # 所以每个版本都要嵌图，不能只嵌一张。
    # 字形图已用调色板 PNG 压到约 1.9KB/张，全部版本嵌进来也就几 MB。
    glyph_img = {}
    missing_img = []
    order = {}
    for i, g in enumerate(glyphs):
        gid = g.get("id")
        if not gid:
            continue
        order[gid] = i
        img = IMGDIR / f"{gid}.png"
        if img.exists():
            b64 = base64.b64encode(img.read_bytes()).decode("ascii")
            glyph_img[gid] = "data:image/png;base64," + b64
        else:
            missing_img.append(gid)

    # 字 → 该字所有版本（默认顺序：已核对优先，其次原顺序），前端靠它列版本
    by_char = {}
    for g in glyphs:
        ch = g.get("char")
        gid = g.get("id")
        if ch and gid:
            by_char.setdefault(ch, []).append(gid)
    for ch, ids in by_char.items():
        by_char[ch] = sorted(ids, key=lambda i: (
            0 if recs_by_id[i].get("verified") == "已核对" else 1, order[i]))

    data["glyph_img"] = glyph_img
    data["by_char"] = by_char

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

    multi = {c: len(v) for c, v in by_char.items() if len(v) > 1}
    print(f"已生成 {DST}（{DST.stat().st_size/1024/1024:.1f} MB）")
    print(f"字形记录：{len(glyphs)} 条，嵌入版本图：{len(glyph_img)} 张，"
          f"按字去重：{len(by_char)} 字")
    print(f"其中多版本字：{len(multi)} 个"
          + ("" if not multi else "（最多的几个："
             + "、".join(f"{c}×{n}" for c, n in
                        sorted(multi.items(), key=lambda kv: -kv[1])[:5]) + "）"))
    if missing_img:
        print(f"缺图：{len(missing_img)} 字没有对应的 web/glyphs 图片，"
              f"先跑 python tools/make_webglyphs.py  → {missing_img[:10]}")
    for nature, n in count.items():
        print(f"  {nature}：{n} 条")


if __name__ == "__main__":
    main()
