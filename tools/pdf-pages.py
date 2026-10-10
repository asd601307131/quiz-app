"""检查扫描版 PDF 的页数与每页图片情况，并把页面导出为 PNG 供识别。"""
import sys
import os
from pypdf import PdfReader

src = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)

reader = PdfReader(src)
print(f"页数: {len(reader.pages)}")

total_imgs = 0
for i, page in enumerate(reader.pages, 1):
    try:
        imgs = list(page.images)
    except Exception as e:
        print(f"  第 {i} 页读取图片失败: {e}")
        imgs = []
    total_imgs += len(imgs)
    size = page.mediabox
    w = float(size.width)
    h = float(size.height)
    names = ", ".join(f"{im.name}({len(im.data)//1024}KB)" for im in imgs[:3])
    print(f"  第 {i} 页: {w:.0f}x{h:.0f}pt  图片 {len(imgs)} 张  {names}")
    for j, im in enumerate(imgs, 1):
        ext = "png"
        try:
            ext = im.name.rsplit(".", 1)[-1].lower()
        except Exception:
            pass
        if ext not in ("png", "jpg", "jpeg"):
            ext = "png"
        dst = os.path.join(outdir, f"p{i:02d}_{j}.{ext}")
        with open(dst, "wb") as fh:
            fh.write(im.data)

print(f"合计图片: {total_imgs}")
# 提取到的文本量（扫描版应为 0）
text_len = sum(len(p.extract_text() or "") for p in reader.pages[:5])
print(f"前 5 页可提取文本字符数: {text_len}  （0 表示纯扫描图）")
