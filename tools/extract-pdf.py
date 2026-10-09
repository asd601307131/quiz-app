"""抽取 PDF 文本，输出到 work/pdf-text/*.txt，便于后续整理题目。

用法:
    python tools/extract-pdf.py <pdf文件或目录> [更多路径...]

说明:
    - 保留页码标记，方便回溯原文档
    - 报告每页抽取到的字符数，少于 20 字的页很可能是扫描图片，需要 OCR
"""

import sys
import re
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("缺少 pypdf，请先安装：python -m pip install pypdf --proxy=")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "work" / "pdf-text"


def safe_name(name: str) -> str:
    """把书名号、空格等字符换成安全文件名"""
    name = re.sub(r"[《》\s]+", "_", name)
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    return name.strip("_")


def extract_one(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    pages = []
    empty_pages = []

    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # 个别页解析失败不应中断整体
            text = ""
            print(f"      第 {i} 页解析异常: {exc}")

        text = text.replace("\r\n", "\n").strip()
        chars = len(re.sub(r"\s", "", text))
        if chars < 20:
            empty_pages.append(i)

        pages.append(f"\n===== 第 {i} 页 =====\n{text}\n")

    out_name = safe_name(pdf_path.stem) + ".txt"
    out_path = OUT_DIR / out_name
    out_path.write_text("".join(pages), encoding="utf-8")

    total_chars = sum(len(re.sub(r"\s", "", p)) for p in pages)
    return {
        "name": pdf_path.name,
        "out": out_path,
        "pages": len(reader.pages),
        "chars": total_chars,
        "empty": empty_pages,
    }


def collect(paths):
    files = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            files.extend(sorted(p.glob("*.pdf")))
        elif p.suffix.lower() == ".pdf":
            files.append(p)
        else:
            print(f"跳过（不是 PDF）: {p}")
    return files


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = collect(args)
    if not files:
        print("没有找到 PDF 文件")
        sys.exit(1)

    print(f"\n输出目录: {OUT_DIR}\n")
    results = []
    for f in files:
        print(f"  正在解析: {f.name}")
        try:
            results.append(extract_one(f))
        except Exception as exc:
            print(f"    失败: {exc}")

    print("\n结果:")
    for r in results:
        flag = ""
        if r["empty"]:
            flag = f"   [!] {len(r['empty'])} pages have almost no text (likely scanned images)"
        print(f"  [OK] {r['name']}")
        print(f"      {r['pages']} 页, {r['chars']} 字 -> {r['out'].relative_to(ROOT)}{flag}")
    print()


if __name__ == "__main__":
    main()
