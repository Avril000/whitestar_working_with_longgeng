"""提交前对比：工作空间（源） vs 桌面仓库（目标）
只列差异，不动任何文件。跳过 .git 和 web/glyphs（图已嵌进 data.js，且 git ignore）。
"""
import os
import sys

SRC = r"D:\wockbuddy\工作空间\2026-10-15-19-35-52\whitestar_working_with_longgeng"
DST = r"D:\桌面\whitestar_working_with_longgeng"
SKIP_DIRS = {".git", "glyphs"}
SKIP_FILES = set()


def walk(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel == ".":
            rel = ""
        for f in filenames:
            key = (rel + "/" + f) if rel else f
            try:
                out[key] = os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                out[key] = -1
    return out


def main():
    a = walk(SRC)
    b = walk(DST)

    changed, new, gone = [], [], []
    for k, sa in a.items():
        if k not in b:
            new.append(k)
        elif b[k] != sa:
            changed.append((k, b[k], sa))
    for k in b:
        if k not in a:
            gone.append(k)

    print("源端文件数：%d    目标端文件数：%d" % (len(a), len(b)))
    print("\n【新增】%d 个" % len(new))
    for k in sorted(new)[:40]:
        print("   + " + k)
    if len(new) > 40:
        print("   ...还有 %d 个" % (len(new) - 40))

    print("\n【有变化】%d 个" % len(changed))
    for k, sb, sa in sorted(changed)[:60]:
        print("   ~ %s   (%d KB -> %d KB)" % (k, sb // 1024, sa // 1024))
    if len(changed) > 60:
        print("   ...还有 %d 个" % (len(changed) - 60))

    print("\n【目标独有】（不会被删，只是提醒）%d 个" % len(gone))
    for k in sorted(gone)[:25]:
        print("   - " + k)
    if len(gone) > 25:
        print("   ...还有 %d 个" % (len(gone) - 25))


if __name__ == "__main__":
    main()
