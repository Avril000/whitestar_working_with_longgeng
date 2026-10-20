"""一条龙：一张页图 → 一批给组员的卡片包

为什么要有这个脚本：
    切字、出网格图、生成 csv、打包，原本是四条命令。
    对不熟悉命令行的队友来说，命令一多就容易漏掉中间某一步。

它做的事（按顺序）：
    1. 找到 data/processed/ 下面的页图（01.png、02.png……）
    2. 每页自动切字      → data/processed/glyphs_XX/crop/
    3. 拼字块总览图      → data/processed/glyphs_XX/card_sheet.png
    4. 生成 csv 卡片     → data/cards/卡片_XX页.csv
    5. 打个包给组员      → dist/卡片包_YYYYMMDD/ 和同名 .zip

用法（勾选不熟悉命令行的队友，直接双击根目录的「一键_出卡片包.bat」即可）：
    python tools/pipeline_out.py              # 增量处理：已切过的页跳过
    python tools/pipeline_out.py 02 03        # 只处理这两页
    python tools/pipeline_out.py --force      # 全部重切（旧结果先挪去 _stale/，不删）
    python tools/pipeline_out.py --no-pack    # 不打包，只出卡片
"""

import argparse
import datetime as dt
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
CARDS = ROOT / "data" / "cards"
DIST = ROOT / "dist"
TOOLS = ROOT / "tools"

sys.path.insert(0, str(TOOLS))

# 关掉输出缓冲：不然父进程打印的内容会跑到子进程输出后面，看着像乱序
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def run(script, *args):
    """用当前解释器跑同目录下的脚本，出错就中断"""
    sys.stdout.flush()
    cmd = [sys.executable, str(TOOLS / script), *map(str, args)]
    r = subprocess.run(cmd)
    sys.stdout.flush()
    if r.returncode != 0:
        print(f"\n[失败] {script} 返回码 {r.returncode}，先停在这里，别往下走。")
        sys.exit(r.returncode)


def existing_blocks(page):
    d = PROCESSED / f"glyphs_{page}" / "crop"
    return len(list(d.glob("*.png"))) if d.exists() else 0


def archive_old(page):
    """重切前把旧结果挪走，而不是删掉——万一新参数切坏了还能翻回去"""
    gdir = PROCESSED / f"glyphs_{page}"
    if not gdir.exists():
        return
    stale = gdir / "_stale" / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    moved = 0
    for sub in ("crop", "bin"):
        s = gdir / sub
        if s.exists() and any(s.iterdir()):
            stale.mkdir(parents=True, exist_ok=True)
            shutil.move(str(s), str(stale / sub))
            s.mkdir(parents=True, exist_ok=True)
            moved += 1
    for mf in gdir.glob("meta_*.json"):
        stale.mkdir(parents=True, exist_ok=True)
        shutil.move(str(mf), str(stale / mf.name))
        moved += 1
    if moved:
        print(f"  旧结果已挪到 {stale.relative_to(ROOT)}")


def build_pack(pages, with_crops=True):
    """把组员需要的文件收进一个文件夹，再压成 zip"""
    day = dt.datetime.now().strftime("%Y%m%d")
    pkg = DIST / f"卡片包_{day}"
    if pkg.exists():
        shutil.rmtree(pkg)
    (pkg / "单字图").mkdir(parents=True)

    n = 0
    guide = CARDS / "填写说明.md"
    if guide.exists():
        shutil.copy2(guide, pkg / guide.name)

    for page in pages:
        csvf = CARDS / f"卡片_{page}页.csv"
        if csvf.exists():
            shutil.copy2(csvf, pkg / csvf.name)
            n += 1
        sheet = PROCESSED / f"glyphs_{page}" / "card_sheet.png"
        if sheet.exists():
            # 名字改成组员一眼能懂的
            shutil.copy2(sheet, pkg / f"{page}页_字块总览.png")
        if with_crops:
            src = PROCESSED / f"glyphs_{page}" / "crop"
            if src.exists():
                dst = pkg / "单字图" / page
                dst.mkdir(parents=True, exist_ok=True)
                for p in src.glob("*.png"):
                    shutil.copy2(p, dst / p.name)

    zpath = DIST / f"{pkg.name}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in pkg.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(pkg.parent))

    size = zpath.stat().st_size / 1024 / 1024
    print(f"\n交付包 → {pkg.relative_to(ROOT)}")
    print(f"  压缩包 → {zpath.relative_to(ROOT)}  （{size:.1f} MB，直接发群里）")
    print(f"  里面 {n} 张卡片 + {len(pages)} 张字块总览图 + {'单字图' if with_crops else '无单字图'}")
    return pkg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", help="只处理指定页，如 02 03；不填则全做")
    ap.add_argument("--force", action="store_true", help="已切过的页也重切")
    ap.add_argument("--no-pack", action="store_true", help="不打包")
    ap.add_argument("--no-crops", action="store_true", help="包里不带单字图（体积小一半）")
    args = ap.parse_args()

    all_pages = sorted(p.stem for p in PROCESSED.glob("*.png")
                       if p.stem.isdigit())
    pages = args.pages or all_pages
    missing = [p for p in pages if not (PROCESSED / f"{p}.png").exists()]
    if missing:
        print(f"[停] 找不到页图：{', '.join(p + '.png' for p in missing)}")
        print(f"     请先放到 {PROCESSED} 下面，文件名用 01.png / 02.png 这样。")
        return
    if not pages:
        print("[停] data/processed/ 里没有 01.png 这样的页图。")
        return

    print(f"要处理的页：{', '.join(pages)}\n")
    done = []
    for page in pages:
        n = existing_blocks(page)
        print(f"—— 第 {page} 页 " + "-" * 40)
        if n and not args.force:
            print(f"  已有 {n} 个字块，跳过切字（想重切加 --force，或双击「强制重切.bat」）")
        else:
            if n:
                archive_old(page)
            run("crop_glyphs.py", PROCESSED / f"{page}.png")
        done.append(page)

    print()
    run("build_cards.py")

    # 网格图要在卡片之后生成，才能按卡片序号排
    import make_sheet
    print()
    for page in done:
        make_sheet.make_page(page)

    if not args.no_pack:
        build_pack(done, with_crops=not args.no_crops)

    print("\n完成。把 dist/ 里的 zip 发群里，让组员照《填写说明》填就行。")


if __name__ == "__main__":
    main()
