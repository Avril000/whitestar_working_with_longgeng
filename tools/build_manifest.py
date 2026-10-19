"""把字形元数据 JSON 转成网页能直接读取的 data.js

为什么要有这一步：
    浏览器直接打开本地网页时（file://），会因为安全策略拒绝读取 JSON 文件。
    所以先把 JSON 转成一个普通的 JS 文件，网页就能双击直接运行，不需要起服务器。

用法（在项目根目录下执行）：
    python tools/build_manifest.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "metadata" / "glyphs.json"
DST = ROOT / "web" / "data.js"


def main():
    if not SRC.exists():
        print(f"找不到源文件：{SRC}")
        return

    data = json.loads(SRC.read_text(encoding="utf-8"))

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

    print(f"已生成 {DST}")
    print(f"字形记录：{len(glyphs)} 条")
    for nature, n in count.items():
        print(f"  {nature}：{n} 条")


if __name__ == "__main__":
    main()
