"""把碑帖 PDF 的每一页渲染成高清页图，供后续切字使用

用法：
    python tools/pdf_to_pages.py data/raw/多宝塔碑.pdf
    python tools/pdf_to_pages.py data/raw/多宝塔碑.pdf data/processed/dbt

默认输出到 data/processed/pages，300 DPI（足够切单字，再高体积会失控）。
"""

import sys
from pathlib import Path

import fitz  # PyMuPDF


def main():
    if len(sys.argv) < 2:
        print("用法：python tools/pdf_to_pages.py <PDF路径> [输出目录]")
        print("例：  python tools/pdf_to_pages.py data/raw/duobao.pdf")
        return

    pdf_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/processed/pages")

    if not pdf_path.exists():
        print(f"找不到文件：{pdf_path}")
        return

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"打开 PDF 失败：{e}")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"共 {len(doc)} 页，正在渲染到 {out_dir} ...")

    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=300)
        out = out_dir / f"{pdf_path.stem}_{i + 1:03d}.png"
        pix.save(out)
        print(f"  {out.name}  {pix.width}x{pix.height}")

    doc.close()
    print(f"完成：{len(doc)} 页")


if __name__ == "__main__":
    main()
