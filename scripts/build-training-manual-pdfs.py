#!/usr/bin/env python
"""Build illustrated role-based training manual PDFs.

The source manuals are Markdown files under docs/manual-training-2026-08.
This renderer is intentionally conservative: it supports the document
features used by those manuals (headings, paragraphs, bullets, tables, and
local images) and embeds the Sarabun font for Thai text.
"""

from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "docs" / "manual-training-2026-08"
OUT_DIR = SRC_DIR / "pdf"
WEB_OUT_DIR = ROOT / "docs" / "manual-pdf" / "training-2026-08"
FONT_DIR = ROOT / "docs" / "manual-html" / "fonts"
REGULAR_FONT = FONT_DIR / "Sarabun-Regular.ttf"
BOLD_FONT = FONT_DIR / "Sarabun-Bold.ttf"

FILES = [
    ("README.md", "00-สารบัญชุดคู่มืออบรม.pdf", "00-index.pdf"),
    ("00-shared-login-and-security.md", "00-คู่มือร่วม-เข้าสู่ระบบและความปลอดภัย.pdf", "00-login-security.pdf"),
    ("01-admin.md", "01-คู่มือผู้ดูแลระบบ-Admin.pdf", "01-admin.pdf"),
    ("02-province.md", "02-คู่มือจังหวัด-Province.pdf", "02-province.pdf"),
    ("03-affiliation.md", "03-คู่มือสังกัดเขต-Affiliation.pdf", "03-affiliation.pdf"),
    ("04-school-full.md", "04-คู่มือโรงเรียนเต็มสิทธิ์-School-Full.pdf", "04-school-full.pdf"),
    ("05-school-teacher.md", "05-คู่มือครูประจำสายชั้น-School-Teacher.pdf", "05-school-teacher.pdf"),
    ("06-driver.md", "06-คู่มือคนขับ-Driver.pdf", "06-driver.pdf"),
    ("07-transport.md", "07-คู่มือขนส่ง-Transport.pdf", "07-transport.pdf"),
    ("08-parent-line.md", "08-คู่มือผู้ปกครอง-LINE-OA.pdf", "08-parent-line.pdf"),
    ("09-teacher-training-prep.md", "09-เอกสารเตรียมอบรมครู-ผลทดสอบระบบจริง.pdf", "09-teacher-training-prep.pdf"),
]


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Sarabun", str(REGULAR_FONT)))
    pdfmetrics.registerFont(TTFont("Sarabun-Bold", str(BOLD_FONT)))


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ThaiTitle",
            parent=base["Title"],
            fontName="Sarabun-Bold",
            fontSize=22,
            leading=30,
            textColor=colors.HexColor("#183A5A"),
            spaceAfter=14,
        ),
        "h1": ParagraphStyle(
            "ThaiH1",
            parent=base["Heading1"],
            fontName="Sarabun-Bold",
            fontSize=18,
            leading=25,
            textColor=colors.HexColor("#183A5A"),
            spaceBefore=12,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "ThaiH2",
            parent=base["Heading2"],
            fontName="Sarabun-Bold",
            fontSize=15,
            leading=22,
            textColor=colors.HexColor("#245D7A"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "ThaiBody",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=11,
            leading=17,
            spaceAfter=6,
        ),
        "note": ParagraphStyle(
            "ThaiNote",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=10,
            leading=15,
            textColor=colors.HexColor("#4A5568"),
            leftIndent=8,
            rightIndent=8,
            borderColor=colors.HexColor("#D5E4EA"),
            borderWidth=0.75,
            borderPadding=6,
            backColor=colors.HexColor("#F6FAFC"),
            spaceAfter=8,
        ),
        "caption": ParagraphStyle(
            "ThaiCaption",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=9,
            leading=13,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#5B6770"),
            spaceAfter=10,
        ),
        "table": ParagraphStyle(
            "ThaiTable",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=9,
            leading=12,
        ),
        "table_header": ParagraphStyle(
            "ThaiTableHeader",
            parent=base["BodyText"],
            fontName="Sarabun-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.white,
        ),
    }


def clean_inline(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", text)
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r'<font name="Sarabun-Bold">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r'<font name="Sarabun-Bold">\1</font>', text)
    return text


def paragraph(text: str, style) -> Paragraph:
    return Paragraph(clean_inline(text), style)


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def is_separator(line: str) -> bool:
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def image_flow(src_md: Path, alt: str, rel: str, st) -> list:
    img_path = (src_md.parent / rel).resolve()
    if not img_path.exists():
        return [paragraph(f"[ภาพไม่พบ: {rel}]", st["note"])]
    max_w = A4[0] - 3.6 * cm
    max_h = 12.5 * cm
    img = Image(str(img_path))
    scale = min(max_w / img.imageWidth, max_h / img.imageHeight, 1)
    img.drawWidth = img.imageWidth * scale
    img.drawHeight = img.imageHeight * scale
    return [KeepTogether([img])]


def parse_markdown(src_md: Path) -> list:
    st = styles()
    lines = src_md.read_text(encoding="utf-8").splitlines()
    story: list = []
    bullets: list[str] = []
    i = 0

    def flush_bullets():
        nonlocal bullets
        if not bullets:
            return
        items = [ListItem(paragraph(item, st["body"]), leftIndent=10) for item in bullets]
        story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=18))
        story.append(Spacer(1, 4))
        bullets = []

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            flush_bullets()
            i += 1
            continue

        img_match = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
        if img_match:
            flush_bullets()
            story.extend(image_flow(src_md, img_match.group(1), img_match.group(2), st))
            i += 1
            continue

        if stripped == "---":
            flush_bullets()
            story.append(Spacer(1, 8))
            i += 1
            continue

        if stripped.startswith("|"):
            flush_bullets()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            if len(table_lines) >= 2 and is_separator(table_lines[1]):
                header = split_table_row(table_lines[0])
                body = [split_table_row(row) for row in table_lines[2:]]
                data = [[paragraph(cell, st["table_header"]) for cell in header]]
                data += [[paragraph(cell, st["table"]) for cell in row] for row in body]
                col_count = max(len(row) for row in data)
                for row in data:
                    while len(row) < col_count:
                        row.append(paragraph("", st["table"]))
                width = A4[0] - 3.6 * cm
                table = Table(data, repeatRows=1, colWidths=[width / col_count] * col_count)
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#245D7A")),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D5DDE3")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAFC")]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]))
                story.append(table)
                story.append(Spacer(1, 8))
            continue

        if stripped.startswith("# "):
            flush_bullets()
            if story:
                story.append(PageBreak())
            story.append(paragraph(stripped[2:], st["title"]))
        elif stripped.startswith("## "):
            flush_bullets()
            story.append(paragraph(stripped[3:], st["h1"]))
        elif stripped.startswith("### "):
            flush_bullets()
            story.append(paragraph(stripped[4:], st["h2"]))
        elif stripped.startswith(">"):
            flush_bullets()
            story.append(paragraph(stripped.lstrip("> "), st["note"]))
        elif re.match(r"^[-*]\s+", stripped):
            bullets.append(re.sub(r"^[-*]\s+", "", stripped))
        elif re.match(r"^\d+\.\s+", stripped):
            flush_bullets()
            story.append(paragraph(stripped, st["body"]))
        else:
            flush_bullets()
            story.append(paragraph(stripped, st["body"]))
        i += 1

    flush_bullets()
    return story


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Sarabun", 8)
    canvas.setFillColor(colors.HexColor("#667085"))
    canvas.drawString(1.8 * cm, 1.0 * cm, "School Safe Connect - คู่มือการใช้งานระบบรถรับส่งนักเรียนจังหวัดลำปาง")
    canvas.drawRightString(A4[0] - 1.8 * cm, 1.0 * cm, f"หน้า {doc.page}")
    canvas.restoreState()


def build_one(src_name: str, out_name: str) -> Path:
    src = SRC_DIR / src_name
    out = OUT_DIR / out_name
    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.7 * cm,
        title=out.stem,
        author="School Safe Connect",
    )
    doc.build(parse_markdown(src), onFirstPage=footer, onLaterPages=footer)
    return out


def publish_web_pdf(src_pdf: Path, web_name: str) -> Path:
    """Expose a built PDF under its stable web name.

    These entries are symlinks into manual-training-2026-08/pdf/, where the
    real files live, and the server serves them through those links.

    Windows refuses os.symlink without elevation or Developer Mode. Copying the
    PDF instead makes the file readable locally but breaks the repository: git
    still records mode 120000 for the path, so the whole PDF body lands in a
    blob that is supposed to hold a short path. Checking that out on Linux
    calls symlink() with megabytes as the link target and fails with
    ENAMETOOLONG — it took a production deploy down twice.

    With core.symlinks=false (git's default on Windows) git represents a
    symlink exactly as a small text file holding the target path, so writing
    that same text keeps the repository correct. The local file is then not a
    readable PDF on Windows, which is the normal trade-off for symlinks there —
    read the real file under manual-training-2026-08/pdf/ instead.
    """
    web_path = WEB_OUT_DIR / web_name
    relative_target = Path("..") / ".." / "manual-training-2026-08" / "pdf" / src_pdf.name
    if web_path.exists() or web_path.is_symlink():
        web_path.unlink()
    try:
        web_path.symlink_to(relative_target)
    except OSError:
        web_path.write_text(relative_target.as_posix(), encoding="utf-8", newline="")
    return web_path


def main() -> None:
    register_fonts()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WEB_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for src, out, web_out in FILES:
        result = build_one(src, out)
        publish_web_pdf(result, web_out)
        print(result)


if __name__ == "__main__":
    main()
