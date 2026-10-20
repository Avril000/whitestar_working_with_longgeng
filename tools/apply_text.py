"""把碑文释文按顺序"对号入座"到某一页切好的字块上

为什么要有这个：
    珍宝馆「单字临摹」页是按碑文顺序排的，而且页面上的字**可以整页复制成文本**。
    既然有文本，就不用人眼去认小字了——按序号一一对应即可，准确率 100%。

它做的事：
    读 data/metadata/多宝塔碑_释文.txt（一行 30 字，# 开头是注释），
    把第 N 个字填到第 N 个字块上，同时把「碑文第 N 字」写进出处。

用法：
    python tools/apply_text.py 05                       # 从释文第 1 字开始对
    python tools/apply_text.py 06 --start 201           # 这一页从第 201 字开始
    python tools/apply_text.py 05 --dry                 # 只看对不对得上，不写
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
TEXT = ROOT / "data" / "metadata" / "多宝塔碑_释文.txt"

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def load_text(path):
    """读释文：跳过 # 注释行，其余行的空白全部去掉后连成一串"""
    body = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        body.append("".join(s.split()))
    return "".join(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="页序号，如 05")
    ap.add_argument("--start", type=int, default=1,
                    help="本页第 1 个字块对应释文第几字（默认 1）")
    ap.add_argument("--text", default=None, help="释文文件路径")
    ap.add_argument("--dry", action="store_true", help="只检查数量对不对，不写入")
    args = ap.parse_args()

    gdir = PROCESSED / f"glyphs_{args.page}"
    metas = sorted(gdir.glob("meta_*.json"))
    if not metas:
        print(f"[停] 找不到 {gdir}/meta_*.json，先跑 crop_grid.py 切字")
        return
    mf = metas[0]

    tpath = Path(args.text) if args.text else TEXT
    if not tpath.exists():
        print(f"[停] 找不到释文：{tpath}")
        return
    body = load_text(tpath)
    print(f"释文 {len(body)} 字（{tpath.name}）")

    data = json.loads(mf.read_text(encoding="utf-8"))
    glyphs = sorted(data["glyphs"], key=lambda r: r.get("read_order", 0))
    print(f"第 {args.page} 页有 {len(glyphs)} 个字块")

    need = args.start - 1 + len(glyphs)
    if need > len(body):
        print(f"[停] 释文不够长：本页需要到第 {need} 字，释文只有 {len(body)} 字。"
              f"检查 --start 是不是填错了。")
        return

    print(f"对应范围：释文第 {args.start} ~ {need} 字")
    if args.dry:
        print("\n（--dry 模式，不写入）对应关系预览：")
        for i, r in enumerate(glyphs[:10]):
            print(f"  {r['id']}  →  第{args.start + i}字  {body[args.start - 1 + i]}")
        print("  ...")
        return

    for i, r in enumerate(glyphs):
        n = args.start + i
        ch = body[n - 1]
        r["ai_guess"] = ch
        r["order_in_text"] = n
        r["src_page"] = f"碑文第{n}字"
        r["note"] = "长庚按珍宝馆释文对号入座，请核对"
    data["text_source"] = tpath.name
    data["text_start"] = args.start

    mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已写入 {mf.name}：第 {args.start}~{need} 字")
    print("  前 20 个：", "".join(body[args.start - 1:args.start + 19]))


if __name__ == "__main__":
    main()
