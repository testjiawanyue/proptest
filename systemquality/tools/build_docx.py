from pathlib import Path
import json
import re

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT_DOCX = ROOT / "AI开发项目质量保证全流程与架构验证方案.docx"
OUT_MD = ROOT / "AI开发项目质量保证全流程与架构验证方案.md"
SOURCE_FILES = [
    ROOT / "01-现状诊断与差距结论.md",
    ROOT / "02-质量保证全流程与介入点.md",
    ROOT / "03-架构验证与门禁体系.md",
    ROOT / "04-效果评估优化与降级方案.md",
    ROOT / "05-落地路线图与责任矩阵.md",
]
EVIDENCE_FILE = ROOT / "evidence-template.md"

NAVY = RGBColor(23, 50, 77)
TEAL = RGBColor(31, 122, 140)
ORANGE = RGBColor(194, 106, 46)
GRAY = RGBColor(102, 114, 125)
WHITE = RGBColor(255, 255, 255)
LIGHT_BLUE = "EAF2F5"
LIGHTER_BLUE = "F4F8FA"
PALE_ORANGE = "F7F1EC"
TABLE_ALT = "F6F8F9"
BORDER = "C9D6DD"


def set_run_font(run, name="微软雅黑", size=None, bold=None, color=None, italic=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color


def shade_cell(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=100, bottom=80, end=100):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.find(qn("w:tcMar"))
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for tag, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{tag}"))
        if node is None:
            node = OxmlElement(f"w:{tag}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=BORDER, size="4"):
    if not isinstance(color, str):
        color = str(color)
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = borders.find(qn(f"w:{edge}"))
        if el is None:
            el = OxmlElement(f"w:{edge}")
            borders.append(el)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), size)
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def add_page_number(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)
    run._r.append(text)
    run._r.append(fld_end)
    set_run_font(run, size=8.5, color=GRAY)


def add_inline_runs(paragraph, text, size=10.5, color=NAVY):
    tokens = re.split(r"(\*\*.*?\*\*|`.*?`)", text)
    for token in tokens:
        if not token:
            continue
        if token.startswith("**") and token.endswith("**") and len(token) > 4:
            run = paragraph.add_run(token[2:-2])
            set_run_font(run, size=size, bold=True, color=color)
        elif token.startswith("`") and token.endswith("`") and len(token) > 2:
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, name="Consolas", size=max(8.5, size - 1), color=TEAL)
        else:
            run = paragraph.add_run(token)
            set_run_font(run, size=size, color=color)


def style_document(doc):
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(1.9)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.header_distance = Cm(0.9)
    section.footer_distance = Cm(0.9)
    section.different_first_page_header_footer = True

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "微软雅黑"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = NAVY
    normal.paragraph_format.line_spacing = 1.35
    normal.paragraph_format.space_after = Pt(5)

    for style_name, size, color, before, after in (
        ("Heading 1", 18, NAVY, 8, 8),
        ("Heading 2", 13.5, TEAL, 12, 5),
        ("Heading 3", 11.5, NAVY, 9, 4),
    ):
        style = styles[style_name]
        style.font.name = "微软雅黑"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    for style_name in ("List Bullet", "List Number"):
        style = styles[style_name]
        style.font.name = "微软雅黑"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
        style.font.size = Pt(10.5)
        style.font.color.rgb = NAVY
        style.paragraph_format.space_after = Pt(4)

    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run("AI 开发项目质量保证全流程与架构验证方案")
    set_run_font(run, size=8.5, color=GRAY)
    p.add_run("\t")
    run = p.add_run("分析建议稿")
    set_run_font(run, size=8.5, color=GRAY)

    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run("PROP 项目质量体系分析 · 2026 年 11 月")
    set_run_font(run, size=8.5, color=GRAY)
    p.add_run("\t")
    run = p.add_run("第 ")
    set_run_font(run, size=8.5, color=GRAY)
    add_page_number(p)
    run = p.add_run(" 页")
    set_run_font(run, size=8.5, color=GRAY)


def add_callout(doc, title, body, fill=LIGHT_BLUE, border=TEAL):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    cell = table.cell(0, 0)
    shade_cell(cell, fill)
    set_cell_margins(cell, 130, 170, 130, 170)
    set_table_borders(table, color=border, size="8")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    run = p.add_run(title)
    set_run_font(run, size=10.5, bold=True, color=border)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    add_inline_runs(p2, body, size=9.8, color=NAVY)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_table(doc, rows, header=True):
    if not rows:
        return
    col_count = max(len(r) for r in rows)
    normalized = [r + [""] * (col_count - len(r)) for r in rows]
    table = doc.add_table(rows=len(normalized), cols=col_count)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    set_table_borders(table)
    for r_idx, row in enumerate(normalized):
        prevent_row_split(table.rows[r_idx])
        if r_idx == 0 and header:
            set_repeat_table_header(table.rows[r_idx])
        for c_idx, value in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if r_idx == 0 and header:
                shade_cell(cell, "17324D")
            elif r_idx % 2 == 0:
                shade_cell(cell, TABLE_ALT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            add_inline_runs(
                p,
                str(value).strip(),
                size=8.2,
                color=WHITE if r_idx == 0 and header else NAVY,
            )
            if r_idx == 0 and header:
                for run in p.runs:
                    run.bold = True
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_image(doc, path, alt):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    run.add_picture(str(path), width=Cm(16.7))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(8)
    run = cap.add_run(alt)
    set_run_font(run, size=8.5, color=GRAY, italic=True)


def add_code_block(doc, text):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    shade_cell(cell, "F2F4F5")
    set_cell_margins(cell, 110, 140, 110, 140)
    set_table_borders(table, color="D8E0E4", size="4")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(text)
    set_run_font(run, name="Consolas", size=8.2, color=NAVY)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def parse_markdown(doc, text, base_dir):
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            add_code_block(doc, "\n".join(code_lines))
            continue
        image_match = re.fullmatch(r"!\[(.*?)\]\((.*?)\)", stripped)
        if image_match:
            alt, rel = image_match.groups()
            add_image(doc, base_dir / rel, alt)
            i += 1
            continue
        if stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            rows = []
            for line in table_lines:
                if re.fullmatch(r"\|[\s:\-|]+\|?", line):
                    continue
                cells = [c.strip() for c in line.strip("|").split("|")]
                rows.append(cells)
            add_table(doc, rows, header=True)
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            level = len(heading.group(1))
            text_value = heading.group(2).strip()
            if level == 1:
                p = doc.add_paragraph(style="Heading 1")
                p.paragraph_format.page_break_before = True
                run = p.add_run(text_value)
                set_run_font(run, size=18, bold=True, color=NAVY)
            elif level == 2:
                p = doc.add_paragraph(style="Heading 2")
                run = p.add_run(text_value)
                set_run_font(run, size=13.5, bold=True, color=TEAL)
            else:
                p = doc.add_paragraph(style="Heading 3")
                run = p.add_run(text_value)
                set_run_font(run, size=11.5, bold=True, color=NAVY)
            i += 1
            continue
        if re.match(r"^[-*]\s+", stripped):
            text_value = re.sub(r"^[-*]\s+", "", stripped)
            p = doc.add_paragraph(style="List Bullet")
            add_inline_runs(p, text_value)
            i += 1
            continue
        if re.match(r"^\d+\.\s+", stripped):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.65)
            p.paragraph_format.first_line_indent = Cm(-0.45)
            p.paragraph_format.space_after = Pt(4)
            add_inline_runs(p, stripped)
            i += 1
            continue
        p = doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(0.0)
        add_inline_runs(p, stripped)
        i += 1


def build_main_markdown():
    summary = """# AI 开发项目质量保证全流程与架构验证方案

## 基于现有质量执行方案和 PROP 项目资产的落地设计

2026 年 11 月

## 结论摘要

当前项目已经具备需求基线、模块行为分析、V5 用例、单元测试、运行时探索和缺陷裁定等质量素材，主要短板是缺少一条自动执行、统一取证、按风险阻断、失败后可降级的质量运行链。

建议采用“七阶段流程、七层验证、六道门禁、一套证据账本、一组量化指标”的体系。第一阶段不要追求全量平台，应先在订单、寄送和面单这类高风险纵切面串联现有工具，证明门禁能够发现传统流程遗漏的问题，同时控制误报、耗时和维护成本。

AI 可以参与需求归纳、测试生成、变更影响推荐、缺陷初筛和报告汇总，但不能单独决定真实缺陷和发布放行。最终结论由确定性工具、可复现运行证据、人工裁定和明确审批人共同完成。

## 当前基线

| 项目 | 当前快照 | 说明 |
|---|---:|---|
| V5 用例有效行 | 1,435 | 12 个业务或补充用例表 |
| V5 已通过 | 494 | 约 34.4% |
| V5 未执行 | 907 | 约 63.2% |
| 后端测试文件与方法 | 99 / 约 940 | 静态统计，不代表当前全部执行通过 |
| 前端测试文件与调用 | 44 / 约 897 | 静态统计，不代表当前全部执行通过 |
| 自动探索最近 15 批 | 32 通过 / 33 无法确认 / 13 待确认 | 通过率约 41%，暂不适合硬门禁 |
| 持续集成配置 | 未发现 | 当前门禁尚未形成自动运行链 |

## 阅读导航

1. 现状诊断与差距结论
2. 质量保证全流程与介入点
3. 架构验证与门禁体系
4. 效果评估优化与降级方案
5. 落地路线图与责任矩阵
6. 附录：变更证据包模板

"""
    parts = [summary]
    for path in SOURCE_FILES:
        parts.append(path.read_text(encoding="utf-8").strip())
        parts.append("\n")
    evidence = EVIDENCE_FILE.read_text(encoding="utf-8").strip()
    evidence = re.sub(r"^# .+\n+", "", evidence, count=1)
    parts.append("# 附录：变更证据包模板\n\n" + evidence)
    OUT_MD.write_text("\n\n".join(parts).strip() + "\n", encoding="utf-8")


def add_cover(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(54)
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run("AI 开发项目质量保证\n全流程与架构验证方案")
    set_run_font(run, size=29, bold=True, color=NAVY)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(26)
    run = p.add_run("基于现有质量执行方案和 PROP 项目资产的落地设计")
    set_run_font(run, size=14.5, color=TEAL)

    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    shade_cell(cell, LIGHT_BLUE)
    set_cell_margins(cell, 220, 250, 220, 250)
    set_table_borders(table, color="D6E4EA", size="4")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run("核心判断")
    set_run_font(run, size=11, bold=True, color=TEAL)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    run = p2.add_run("项目不缺质量素材，缺的是一条能自动运行、统一取证、按风险阻断并可在效果不佳时安全降级的质量运行链。")
    set_run_font(run, size=12, color=NAVY)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(40)
    run = p.add_run("分析建议稿")
    set_run_font(run, size=10.5, bold=True, color=ORANGE)
    p = doc.add_paragraph()
    run = p.add_run("2026 年 11 月")
    set_run_font(run, size=10.5, color=GRAY)
    p = doc.add_paragraph()
    run = p.add_run("适用范围：采用 AI 辅助开发的 PROP 全栈业务系统")
    set_run_font(run, size=9.5, color=GRAY)
    doc.add_page_break()


def add_document_control(doc):
    p = doc.add_paragraph(style="Heading 1")
    p.paragraph_format.page_break_before = False
    run = p.add_run("文档说明")
    set_run_font(run, size=18, bold=True, color=NAVY)
    add_table(
        doc,
        [
            ["项目", "内容"],
            ["文档类型", "质量体系分析与实施建议"],
            ["分析范围", "需求准入、设计契约、AI 编码、合并验证、系统验证、发布灰度、线上反馈"],
            ["数据口径", "当前磁盘文件、测试工作簿和已有运行报告快照"],
            ["源码约束", "本次不修改 E:\\proptest\\prop_new 的任何源码、目录或元数据"],
            ["版本", "v1.0"],
            ["日期", "2026-11-23"],
        ],
    )
    add_callout(
        doc,
        "数据边界",
        "本次未执行会写入 prop_new 的构建和测试，因此文中测试数量、V5 执行状态和自动探索结果均为现有文件快照，不代表刚刚实跑结果。正式门禁应以绑定提交号和执行时间的证据包为准。",
        fill=PALE_ORANGE,
        border=ORANGE,
    )
    add_callout(
        doc,
        "建议的决策",
        "先以一个高风险业务纵切面开展 12 周试点，建立 G0 至 G5 门禁和证据账本；新增规则先影子运行，达到稳定标准后再阻断；任何阻断能力都保留告警、核心优先、人工兜底和安全冻结四级降级路径。",
    )


def add_summary_section(doc):
    p = doc.add_paragraph(style="Heading 1")
    p.paragraph_format.page_break_before = False
    run = p.add_run("结论摘要")
    set_run_font(run, size=18, bold=True, color=NAVY)

    summary_paragraphs = [
        "当前项目已经具备需求基线、模块行为分析、V5 用例、单元测试、运行时探索和缺陷裁定等质量素材，主要短板是缺少一条自动执行、统一取证、按风险阻断、失败后可降级的质量运行链。",
        "建议采用七阶段流程、七层验证、六道门禁、一套证据账本和一组量化指标。第一阶段不要追求全量平台，应先在订单、寄送和面单这类高风险纵切面串联现有工具，证明门禁能够发现传统流程遗漏的问题，同时控制误报、耗时和维护成本。",
        "AI 可以参与需求归纳、测试生成、变更影响推荐、缺陷初筛和报告汇总，但不能单独决定真实缺陷和发布放行。最终结论由确定性工具、可复现运行证据、人工裁定和明确审批人共同完成。",
    ]
    for text in summary_paragraphs:
        p = doc.add_paragraph()
        add_inline_runs(p, text, size=10.3)

    add_table(
        doc,
        [
            ["项目", "当前快照", "说明"],
            ["V5 用例有效行", "1,435", "12 个业务或补充用例表"],
            ["V5 已通过", "494", "约 34.4%"],
            ["V5 未执行", "907", "约 63.2%"],
            ["后端测试文件与方法", "99 / 约 940", "静态统计，不代表当前全部执行通过"],
            ["前端测试文件与调用", "44 / 约 897", "静态统计，不代表当前全部执行通过"],
            ["自动探索最近 15 批", "32 通过 / 33 无法确认 / 13 待确认", "通过率约 41%，暂不适合硬门禁"],
            ["持续集成配置", "未发现", "当前门禁尚未形成自动运行链"],
        ],
    )

    p = doc.add_paragraph(style="Heading 2")
    run = p.add_run("阅读导航")
    set_run_font(run, size=13.5, bold=True, color=TEAL)
    p = doc.add_paragraph()
    add_inline_runs(
        p,
        "1. 现状诊断与差距结论　2. 质量保证全流程与介入点　3. 架构验证与门禁体系　4. 效果评估优化与降级方案　5. 落地路线图与责任矩阵　6. 附录：变更证据包模板",
        size=9.8,
        color=GRAY,
    )


def main():
    build_main_markdown()
    doc = Document()
    style_document(doc)
    props = doc.core_properties
    props.title = "AI 开发项目质量保证全流程与架构验证方案"
    props.subject = "基于现有质量执行方案和 PROP 项目资产的落地设计"
    props.author = "质量体系分析"
    props.keywords = "AI 开发, 质量保证, 架构验证, 门禁, 降级"
    props.comments = "项目外质量治理分析，不修改 prop_new 源码。"

    add_cover(doc)
    add_document_control(doc)
    doc.add_page_break()
    add_summary_section(doc)
    for path in SOURCE_FILES:
        parse_markdown(doc, path.read_text(encoding="utf-8"), ROOT)
    evidence = EVIDENCE_FILE.read_text(encoding="utf-8").strip()
    evidence = re.sub(r"^# .+\n+", "", evidence, count=1)
    parse_markdown(doc, "# 附录：变更证据包模板\n\n" + evidence, ROOT)
    doc.save(OUT_DOCX)
    print(f"已生成：{OUT_MD}")
    print(f"已生成：{OUT_DOCX}")


if __name__ == "__main__":
    main()
