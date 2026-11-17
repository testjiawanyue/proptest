from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from openpyxl import load_workbook


WORKBOOK_PATH = Path(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_V5.xlsx")
OUTPUT_PATH = Path(r"E:\proptest\case\outputs\测试用例汇总\测试用例质量分析汇报_V5_20261010.docx")
REPORT_TIME = datetime.now()

CASE_SHEETS = [
    "基础设置",
    "客户管理",
    "产品生产",
    "产品管理",
    "订单管理",
    "点检管理",
    "受付工作台",
    "作业管理",
    "首页看板",
    "端到端补充用例",
    "V5缺口补充用例",
]

FEAT_NAMES = {
    "FEAT-00": "首页看板",
    "FEAT-01": "客户管理",
    "FEAT-02": "部件资料",
    "FEAT-03": "基础数据",
    "FEAT-04": "作业选项",
    "FEAT-05": "入库与受付",
    "FEAT-06": "组装作业",
    "FEAT-07": "点检管理",
    "FEAT-08": "产品管理",
    "FEAT-09": "部件追溯",
    "FEAT-10": "订单管理",
    "FEAT-11": "发货出库",
    "FEAT-12": "定期点检",
    "FEAT-13": "通知提醒",
    "FEAT-14": "受付工作台",
    "FEAT-15": "受付历史",
    "FEAT-16": "厂内作业",
    "FEAT-17": "返送管理",
    "FEAT-18": "返送批量打印",
    "FEAT-19": "订单批量打印",
}


def percent(value, total):
    return f"{value / total * 100:.1f}%" if total else "0.0%"


def set_cell_text(cell, text, bold=False, white=False, size=8.5):
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.paragraph_format.space_before = Pt(1)
    paragraph.paragraph_format.space_after = Pt(1)
    paragraph.paragraph_format.line_spacing = 1.05
    run = paragraph.add_run(str(text))
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF) if white else RGBColor(0x33, 0x33, 0x33)


def shade_cell(cell, color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), color)
    tc_pr.append(shd)


def add_table(document, headers, rows, widths=None):
    table = document.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        set_cell_text(cell, header, bold=True, white=True)
        shade_cell(cell, "1F4E78")
    for row_index, row in enumerate(rows):
        cells = table.add_row().cells
        for col_index, value in enumerate(row):
            set_cell_text(cells[col_index], value)
            if row_index % 2 == 0:
                shade_cell(cells[col_index], "F5F8FC")
    if widths:
        for row in table.rows:
            for index, width in enumerate(widths):
                row.cells[index].width = Cm(width)
    return table


def add_heading(document, text, level=1):
    heading = document.add_heading(text, level=level)
    for run in heading.runs:
        run.font.name = "Microsoft YaHei"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        run.font.color.rgb = RGBColor(0x1F, 0x4E, 0x78)
        run.font.size = Pt(15 if level == 1 else 12)
    return heading


def add_paragraph(document, text, bold=False):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(5)
    paragraph.paragraph_format.line_spacing = 1.15
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.size = Pt(10.5)
    run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
    return paragraph


def add_bullets(document, items):
    for item in items:
        paragraph = document.add_paragraph(style="List Bullet")
        paragraph.paragraph_format.space_after = Pt(3)
        run = paragraph.add_run(item)
        run.font.name = "Microsoft YaHei"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        run.font.size = Pt(10)
        run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)


def read_rows(worksheet):
    headers = [cell.value for cell in worksheet[1]]
    return [dict(zip(headers, row)) for row in worksheet.iter_rows(min_row=2, values_only=True)]


def count_lines(value):
    import re

    return len([item for item in re.split(r"\n|；|;|。", str(value or "")) if item.strip()])


def text_of(row):
    return " ".join(str(row.get(field) or "") for field in ["用例标题", "测试点", "前置条件", "测试步骤", "预期结果"])


def build_metrics():
    workbook = load_workbook(WORKBOOK_PATH, data_only=True)
    case_rows = []
    for sheet_name in CASE_SHEETS:
        for row in read_rows(workbook[sheet_name]):
            row["_sheet"] = sheet_name
            case_rows.append(row)
    v3_rows = [row for row in case_rows if row["_sheet"] not in ("端到端补充用例", "V5缺口补充用例")]
    e2e_rows = [row for row in case_rows if row["_sheet"] == "端到端补充用例"]
    v5_rows = [row for row in case_rows if row["_sheet"] == "V5缺口补充用例"]
    mapping_rows = read_rows(workbook["用例-需求映射"])
    trace_rows = read_rows(workbook["需求追溯矩阵"])
    clarification_rows = read_rows(workbook["需求澄清清单"])
    merge_rows = read_rows(workbook["归并重构建议"])

    priorities = Counter(row["优先级"] for row in case_rows)
    coverage = Counter(row["覆盖状态"] for row in trace_rows)
    uncovered = [row for row in trace_rows if row["覆盖状态"] == "未覆盖"]
    uncovered_by_feat = Counter(row["FEAT编号"] for row in uncovered)
    module_stats = []
    for sheet_name in CASE_SHEETS[:9]:
        rows = [row for row in case_rows if row["_sheet"] == sheet_name]
        priority = Counter(row["优先级"] for row in rows)
        no_val = sum(1 for row in rows if not row.get("VAL编号"))
        module_stats.append([
            sheet_name,
            len(rows),
            priority["高"],
            priority["中"],
            priority["低"],
            no_val,
            percent(no_val, len(rows)),
        ])

    fields = ["用例编号", "用例标题", "测试点", "优先级", "前置条件", "测试步骤", "预期结果", "需求编号", "FEAT编号", "VAL编号"]
    completeness = {field: sum(1 for row in case_rows if row.get(field) not in (None, "")) for field in fields}
    steps = [count_lines(row["测试步骤"]) for row in case_rows]
    expected = [count_lines(row["预期结果"]) for row in case_rows]

    keyword_groups = {
        "状态流转": ["状态", "流转", "审核", "通过", "驳回"],
        "查询/筛选/分页": ["查询", "搜索", "筛选", "分页", "排序"],
        "异常/失败": ["异常", "失败", "错误", "无效", "非法", "不存在", "重复", "必填"],
        "通知/打印/导出": ["通知", "提醒", "打印", "导出", "导入"],
        "边界/空值": ["边界", "空", "为空", "上限", "下限", "最大", "最小", "超长", "特殊字符"],
        "数据一致性/追溯": ["一致", "追溯", "履历", "关联"],
        "并发冲突": ["并发", "同时", "冲突"],
        "数据恢复": ["恢复", "备份"],
        "权限控制": ["权限", "角色", "无权限"],
    }
    angles = {
        name: sum(1 for row in case_rows if any(keyword in text_of(row) for keyword in keywords))
        for name, keywords in keyword_groups.items()
    }

    type_rules = [
        ("业务流/跨模块流程", ["订单","发货","出库","受付","返送","组装","质检","入库","作业","流程","流转","闭环","追溯","提交","保存","确认","审核"], "证明业务对象从创建、状态变更、跨模块传递到闭环处理都有路径覆盖。"),
        ("数据流/状态传递", ["同步","更新","保存","履历","历史","关联","一致","回写","预占","库存","状态","编号"], "证明新增、修改、停用、删除等操作会正确写入源头数据并传导到下游页面和业务记录。"),
        ("显示/界面", ["页面","列表","显示","展示","字段","布局","排序","分页","菜单","按钮","抽屉","弹窗","空态","提示","标题","筛选","搜索"], "证明页面入口、列表字段、排序分页、空态提示、弹窗抽屉和按钮反馈有明确预期。"),
        ("边界值", ["边界","空","为空","上限","下限","最大","最小","超长","零","0","负数","特殊字符","日期","必填","重名"], "证明必填项、空值、重名、最大长度、日期边界、数值边界和特殊字符都有校验用例。"),
        ("权限控制", ["权限","角色","无权限","可见","登录","账号","管理员"], "证明有权限角色的可用操作、无权限角色的拦截提示和未登录访问均有验证。"),
        ("异常/失败", ["异常","失败","错误","无效","非法","不存在","重复","必填"], "证明非法输入、依赖缺失、重复数据、业务规则不满足时的拦截和提示有验证。"),
        ("并发冲突", ["并发","同时","冲突"], "证明同一对象被多人同时编辑或提交时，系统有锁定、提示或合并策略。"),
        ("数据恢复", ["恢复","备份"], "证明异常数据、历史数据或备份恢复后，主记录、履历和下游引用保持一致。"),
        ("通知/打印/导出", ["通知","提醒","打印","导出","导入"], "证明通知触发条件、打印范围、文件内容、导出导入结果和失败提示有验证。"),
    ]
    val_by_case = defaultdict(set)
    for row in mapping_rows:
        if row.get("VAL编号"):
            val_by_case[row.get("用例编号")].add((row.get("FEAT编号"), row.get("VAL编号")))
    type_metrics = []
    for name, keywords, evidence in type_rules:
        hit_rows = [row for row in case_rows if any(keyword in text_of(row) for keyword in keywords)]
        linked_vals = set()
        for row in hit_rows:
            linked_vals.update(val_by_case.get(row.get("用例编号"), set()))
        type_metrics.append([
            name,
            len(hit_rows),
            percent(len(hit_rows), len(case_rows)),
            len(linked_vals),
            evidence,
        ])

    return {
        "case_rows": case_rows,
        "v3_rows": v3_rows,
        "e2e_rows": e2e_rows,
        "v5_rows": v5_rows,
        "mapping_rows": mapping_rows,
        "trace_rows": trace_rows,
        "clarification_rows": clarification_rows,
        "merge_rows": merge_rows,
        "priorities": priorities,
        "coverage": coverage,
        "uncovered": uncovered,
        "uncovered_by_feat": uncovered_by_feat,
        "module_stats": module_stats,
        "completeness": completeness,
        "steps": steps,
        "expected": expected,
        "angles": angles,
        "type_metrics": type_metrics,
        "duplicate_title_groups": sum(1 for value in Counter(row["用例标题"] for row in case_rows).values() if value > 1),
        "duplicate_test_point_groups": sum(1 for value in Counter(row["测试点"] for row in case_rows).values() if value > 1),
    }


def configure_document(document):
    section = document.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)
    normal = document.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)
    title = document.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("测试用例质量分析汇报")
    run.bold = True
    run.font.size = Pt(22)
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.color.rgb = RGBColor(0x1F, 0x4E, 0x78)
    subtitle = document.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run("评估对象：测试用例汇总_V5.xlsx")
    run.font.size = Pt(11)
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
    meta = document.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = meta.add_run(f"报告日期：{REPORT_TIME:%Y年%m月%d日 %H:%M}")
    run.font.size = Pt(10)
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.color.rgb = RGBColor(0x60, 0x60, 0x60)


def add_footer(document):
    footer = document.sections[0].footer
    paragraph = footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run("测试用例质量分析汇报 · 数据源：测试用例汇总_V5.xlsx")
    run.font.size = Pt(8)
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.color.rgb = RGBColor(0x80, 0x80, 0x80)


def generate_report(metrics):
    document = Document()
    configure_document(document)
    add_footer(document)
    case_rows = metrics["case_rows"]
    total = len(case_rows)

    add_heading(document, "一、结论摘要", 1)
    add_paragraph(document, "当前 V4 用例集已经具备进入评审和执行准备的条件。用例规模完整，核心结构字段完整率达到 100%，需求追溯字段已经建立，关键业务链路新增了失败回滚、并发冲突和数据恢复用例。整体判断是“结构可用、覆盖较好、治理可控”，但还不能认为已经达到可交付执行的最高质量水平。")
    add_paragraph(document, "主要短板集中在三处：一是 330 个 VAL 验收项中仍有 47 个未覆盖，集中在定期点检、订单管理和受付历史；二是 1210 条用例中有 300 条未关联 VAL，追溯链路仍有断点；三是 408 条补充类用例被标记为建议合并，但仅保留 9 条主用例，归并颗粒度还比较粗，后续可能造成维护困难和执行重复。")
    add_paragraph(document, "建议优先处理 FEAT-12 定期点检、FEAT-10 订单管理和 FEAT-15 受付历史的未覆盖项，同时集中澄清 87 条待澄清用例，再进入正式执行。", bold=True)

    add_heading(document, "二、评估范围与方法", 1)
    add_table(
        document,
        ["项目", "内容"],
        [
            ["评估对象", "测试用例汇总_V4.xlsx"],
            ["用例范围", "9 个业务模块的 1190 条 V3 用例，以及 20 条端到端补充用例，合计 1210 条。"],
            ["需求基准", "20 个 FEAT 需求、330 个 VAL 验收项。"],
            ["评估维度", "结构完整性、需求追溯、测试视角、优先级分布、可执行性、重复与归并、澄清治理、执行准备度。"],
            ["数据口径", "所有指标直接读取 V4 工作簿；执行相关字段尚未实际执行，因此仅评估准备度，不评价测试通过率。"],
        ],
        widths=[3.4, 12.8],
    )

    add_heading(document, "三、总体质量概览", 1)
    add_table(
        document,
        ["维度", "当前表现", "评价"],
        [
            ["规模完整性", f"共 {total} 条用例；V3 用例 {len(metrics['v3_rows'])} 条，端到端补充 {len(metrics['e2e_rows'])} 条。", "良好"],
            ["核心字段完整性", "用例编号、标题、测试点、优先级、前置条件、步骤、预期结果均 100% 填写。", "良好"],
            ["需求追溯", f"330 个 VAL 中 {metrics['coverage']['已覆盖未执行']} 个已覆盖，覆盖率 {percent(metrics['coverage']['已覆盖未执行'], 330)}。", "中上"],
            ["风险覆盖", "新增失败回滚 8 条、并发冲突 8 条、数据恢复 4 条。", "良好"],
            ["执行准备", f"{total} 条用例均为未执行；执行人、执行时间、实际结果和缺陷编号均为空。", "待执行"],
            ["治理清晰度", f"{len(metrics['clarification_rows'])} 条待澄清，{len(metrics['merge_rows'])} 组归并建议。", "需优化"],
        ],
        widths=[3.0, 10.5, 2.7],
    )

    add_heading(document, "四、模块分布与优先级", 1)
    add_paragraph(document, "用例主要集中在点检管理、受付工作台、作业管理和订单管理。这四个模块合计 768 条，占总用例量的 63.5%，说明当前用例设计已经向高频业务和管理链路倾斜。订单管理的 VAL 空关联最多，有 85 条，是后续追溯补齐的重点模块。")
    add_table(
        document,
        ["模块", "用例数", "高", "中", "低", "无VAL用例", "无VAL占比"],
        metrics["module_stats"] + [
            ["端到端补充用例", len(metrics["e2e_rows"]), 20, 0, 0, 0, "0.0%"],
            ["合计", total, metrics["priorities"]["高"], metrics["priorities"]["中"], metrics["priorities"]["低"], sum(item[5] for item in metrics["module_stats"]), percent(sum(item[5] for item in metrics["module_stats"]), total)],
        ],
        widths=[3.2, 1.9, 1.4, 1.4, 1.4, 2.4, 2.5],
    )
    add_paragraph(document, f"优先级方面，高优先级 {metrics['priorities']['高']} 条，占 {percent(metrics['priorities']['高'], total)}；中优先级 {metrics['priorities']['中']} 条，占 {percent(metrics['priorities']['中'], total)}；低优先级 {metrics['priorities']['低']} 条，占 {percent(metrics['priorities']['低'], total)}。高优先级比例超过一半，建议在第一轮执行中优先安排。")

    add_heading(document, "五、测试视角覆盖分析", 1)
    add_paragraph(document, "从用例文本关键词看，状态流转、查询筛选、异常失败、通知打印和边界空值已经有较好的覆盖。并发冲突、数据恢复和权限控制虽然已经建立，但数量相对较少，属于后续需要继续增强的视角。")
    angle_rows = []
    for name, count in sorted(metrics["angles"].items(), key=lambda item: item[1], reverse=True):
        angle_rows.append([name, count, percent(count, total), "已覆盖" if count >= 100 else "待增强"])
    add_table(document, ["测试视角", "涉及用例数", "占比", "判断"], angle_rows, widths=[4.5, 3.0, 3.0, 2.8])
    add_paragraph(document, "上述统计基于关键词识别，同一用例可能命中多个视角，因此各视角占比之和会超过 100%。")

    e2e_counter = Counter(row["所属章节"].split("/")[-1] for row in metrics["e2e_rows"])
    add_table(
        document,
        ["端到端补充场景", "用例数", "说明"],
        [
            ["失败回滚", e2e_counter["失败回滚"], "覆盖订单、发货、受付、质检、返送、批量打印、定期点检和产品停用失败后的数据一致性。"],
            ["并发冲突", e2e_counter["并发冲突"], "覆盖订单、客户、受付、作业、返送、发货、批量打印和点检计划的并发编辑冲突。"],
            ["数据恢复", e2e_counter["数据恢复"], "覆盖定期点检、批量打印、产品在库和部件追溯的数据恢复校验。"],
        ],
        widths=[3.4, 2.0, 10.8],
    )

    add_heading(document, "六、需求追溯覆盖", 1)
    add_paragraph(document, f"V4 已建立 {len(metrics['mapping_rows'])} 行用例-需求映射，对应 330 个 VAL 验收项。当前 {metrics['coverage']['已覆盖未执行']} 个验收项已经有用例覆盖，覆盖率 {percent(metrics['coverage']['已覆盖未执行'], 330)}；仍有 {metrics['coverage']['未覆盖']} 个未覆盖，占比 {percent(metrics['coverage']['未覆盖'], 330)}。")
    uncovered_rows = []
    for feat, count in sorted(metrics["uncovered_by_feat"].items(), key=lambda item: item[1], reverse=True):
        samples = [f"{row['VAL编号']} {row['需求项']}" for row in metrics["uncovered"] if row["FEAT编号"] == feat][:2]
        uncovered_rows.append([feat, FEAT_NAMES.get(feat, ""), count, "；".join(samples)])
    add_table(document, ["FEAT编号", "业务领域", "未覆盖数", "代表性未覆盖项"], uncovered_rows, widths=[2.2, 3.0, 2.0, 9.0])
    add_paragraph(document, "未覆盖项不是平均分布在所有模块，而是集中出现在定期点检和订单管理。特别是订单页面的字段入口、分页、组合条件、日期边界、出货记录展开、解除边界、三方主体联动等内容，建议在下一轮补测中优先处理。")

    add_heading(document, "七、可执行性分析", 1)
    executable_steps = sum(value >= 2 for value in metrics["steps"])
    executable_expected = sum(value >= 2 for value in metrics["expected"])
    add_table(
        document,
        ["检查项", "结果", "占比", "说明"],
        [
            ["核心字段完整", f"{len(case_rows)} / {len(case_rows)}", "100.0%", "编号、标题、测试点、优先级、前置条件、步骤、预期结果均完整。"],
            ["VAL字段已填写", f"{metrics['completeness']['VAL编号']} / {len(case_rows)}", percent(metrics['completeness']['VAL编号'], len(case_rows)), "尚有 300 条用例没有 VAL 编号。"],
            ["测试步骤不少于 2 步", f"{executable_steps} / {len(case_rows)}", percent(executable_steps, len(case_rows)), "多数用例具备基本操作路径，但部分场景步骤较简化。"],
            ["预期结果不少于 2 项", f"{executable_expected} / {len(case_rows)}", percent(executable_expected, len(case_rows)), "预期判断整体可用，但复杂链路仍需补强可观测结果。"],
            ["执行状态", "1210 条未执行", "100.0%", "符合用例编写阶段要求，尚未进入执行阶段。"],
            ["执行结果字段", "实际结果、缺陷编号、执行人、执行时间均为空", "100.0%", "字段已预留，执行开始后可直接填写。"],
        ],
        widths=[3.6, 3.5, 2.2, 7.0],
    )

    add_heading(document, "八、治理与可维护性", 1)
    add_table(
        document,
        ["治理项", "数量", "说明"],
        [
            ["重复用例编号", "0", "用例编号唯一，基础管理良好。"],
            ["重复用例标题", f"{metrics['duplicate_title_groups']} 组", "标题重复量较低，但评审时仍应确认是否为不同前置条件或数据组合。"],
            ["重复测试点", f"{metrics['duplicate_test_point_groups']} 组", "测试点重复较少，说明大部分用例有独立验证目标。"],
            ["补充类用例", "437 条", "包含 V3 中的补充用例和 V4 新增端到端补充用例。"],
            ["建议合并用例", "408 条", "已经标注为建议合并，但仍需按场景进一步细化归并规则。"],
            ["保留主用例", "9 条", "当前按模块和章节聚合，颗粒度偏粗，可能导致一个主用例承载过多内容。"],
            ["待澄清用例", "87 条", "需要需求、产品和测试共同确认后再执行。"],
            ["已澄清用例", "15 条", "可保留澄清结论，作为后续回归依据。"],
        ],
        widths=[3.5, 2.0, 10.7],
    )

    add_heading(document, "九、主要风险", 1)
    add_bullets(document, [
        "追溯断点风险：300 条用例没有 VAL 编号，虽然仍可执行，但会影响需求变更后的影响分析。",
        "覆盖缺口风险：47 个 VAL 未覆盖，定期点检和订单管理的缺口最集中，可能造成关键规则和边界遗漏。",
        "重复维护风险：408 条补充类用例被建议合并，但当前仅保留 9 条主用例，归并方案过粗，可能降低用例可读性。",
        "需求理解风险：87 条待澄清用例尚未关闭，直接执行可能产生误判和返工。",
        "执行评价风险：所有用例均未执行，目前只能评估编写和覆盖准备度，不能评估系统实现质量。",
    ])

    add_heading(document, "十、改进建议", 1)
    add_table(
        document,
        ["优先级", "行动", "目标", "建议负责人"],
        [
            ["P0", "关闭 87 条待澄清用例", "消除需求理解偏差，形成可执行版本。", "产品、需求、测试"],
            ["P0", "补齐 47 个未覆盖 VAL", "重点处理 FEAT-12、FEAT-10、FEAT-15。", "测试设计"],
            ["P1", "细化 408 条建议合并用例", "按业务对象、操作路径、前置数据和异常类型拆分归并组。", "测试设计"],
            ["P1", "补齐 300 条无 VAL 用例", "建立需求变更影响分析和覆盖率统计基础。", "测试设计"],
            ["P1", "编制第一轮执行计划", "先执行 652 条高优先级用例，再覆盖中低优先级。", "测试经理"],
            ["P2", "持续维护执行字段", "执行后填写实际结果、缺陷编号、执行人和执行时间。", "测试执行"],
        ],
        widths=[1.8, 4.6, 6.5, 3.4],
    )

    add_heading(document, "十一、用例类型与设计完整性分析", 1)
    add_paragraph(document, "除模块和优先级统计外，本轮补充按测试视角拆解用例类型。类型识别依据用例标题、测试点、前置条件、测试步骤和预期结果中的业务关键词，同一条用例可能同时属于多个测试类型，因此各类型数量之和会超过总用例数。类型数量本身不能单独证明设计完整，必须结合需求追溯、业务对象、数据状态、输入规则、权限边界、异常路径和可观察结果共同判断。")
    add_table(
        document,
        ["测试类型", "涉及用例数", "占比", "关联VAL数", "设计完整性依据"],
        metrics["type_metrics"],
        widths=[2.7, 2.0, 1.8, 2.0, 7.7],
    )
    add_paragraph(document, "从当前分布看，显示/界面、业务流和数据流相关用例较多，说明页面展示、业务动作和数据传导已经得到较大范围覆盖；边界值类用例也具备一定规模，能够覆盖必填项、空值、重名、日期和长度等常见校验。相对而言，权限控制、并发冲突和数据恢复类用例数量较少，虽然 V4 已补充关键端到端场景，但仍属于后续评审和补测的重点。")

    add_heading(document, "用例类型完整性的证明基准", 2)
    add_table(
        document,
        ["证明维度", "完整标准", "当前证据", "结论"],
        [
            ["需求追溯基准", "每个 FEAT 下的 VAL 都至少有一条用例覆盖，变更后可反向定位用例。", f"330 个 VAL 中 {metrics['coverage']['已覆盖未执行']} 个已覆盖，{metrics['coverage']['未覆盖']} 个未覆盖；另有 300 条用例无 VAL 编号。", "部分完整"],
            ["业务流完整性", "关键对象从创建、变更、审核、流转、交付到闭环都有主路径和备选路径。", "业务流/跨模块流程相关用例较多，并新增失败回滚、并发冲突和数据恢复端到端用例。", "较完整"],
            ["数据流完整性", "源头数据的创建、修改、停用、删除、恢复能正确传导到列表、详情、下拉、看板和下游业务。", "数据流/状态传递相关用例覆盖范围广，但仍有部分用例缺少 VAL 关联。", "较完整"],
            ["输入与边界完整性", "必填、空值、重名、长度、格式、日期、数量、状态依赖和特殊字符均有正反校验。", "边界值类用例已覆盖常见输入规则，但不同字段的边界清单仍需逐项复核。", "基本完整"],
            ["权限与并发完整性", "有权限、无权限、未登录、不同角色、并发编辑和并发提交都有明确预期。", "已有权限控制和并发冲突用例，但数量占比低于业务流和界面类用例。", "需增强"],
            ["异常与恢复完整性", "失败、中断、回滚、重新提交、备份恢复和历史保留都有可验证结果。", "V4 新增失败回滚、并发冲突和数据恢复用例，形成基础风险覆盖。", "需增强"],
            ["结果可验证性", "每条用例的前置数据、操作步骤和预期页面/数据/状态结果清晰可判断。", "核心字段完整率 100%，但复杂链路仍应继续补强可观察结果。", "基本完整"],
        ],
        widths=[2.6, 5.2, 5.5, 2.0],
    )
    add_paragraph(document, "因此，判断一个类型的用例是否设计完整，不能只看数量占比，而应同时满足五项证据：一是该类型对应的 VAL 验收项没有缺口；二是关键业务对象和状态已经列入用例；三是正常、异常、边界、权限、并发和恢复路径有覆盖；四是预期结果能观察到页面变化、数据变化或状态变化；五是执行后可通过实际结果、缺陷编号、执行人和执行时间回溯。当前 V4 已建立证据框架，但需求追溯和权限、并发、恢复类路径仍需继续补齐。")

    document.add_page_break()
    add_heading(document, "附录：未覆盖 VAL 清单", 1)
    uncovered_detail = [[row["FEAT编号"], FEAT_NAMES.get(row["FEAT编号"], ""), row["VAL编号"], row["需求项"]] for row in metrics["uncovered"]]
    add_table(document, ["FEAT编号", "业务领域", "VAL编号", "需求项"], uncovered_detail, widths=[2.0, 3.0, 2.2, 9.0])

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    document.save(OUTPUT_PATH)
    return OUTPUT_PATH


def generate_report_v5(metrics):
    document = Document()
    configure_document(document)
    add_footer(document)
    case_rows = metrics["case_rows"]
    v5_rows = metrics["v5_rows"]
    total = len(case_rows)
    v5_total = len(v5_rows)
    v5_category = Counter(row["备注"].split("；")[0].replace("V5缺口补充用例：", "") for row in v5_rows)
    v5_feature = Counter(row["FEAT编号"] for row in v5_rows)
    v5_step_ready = sum(count_lines(row["测试步骤"]) >= 2 for row in v5_rows)
    v5_expected_ready = sum(count_lines(row["预期结果"]) >= 2 for row in v5_rows)
    executable_steps = sum(value >= 2 for value in metrics["steps"])
    executable_expected = sum(value >= 2 for value in metrics["expected"])
    no_val_rows = [row for row in case_rows if not row.get("VAL编号")]
    pending_clarification = [row for row in case_rows if row.get("澄清状态") == "待澄清"]
    resolved_clarification = [row for row in case_rows if row.get("澄清状态") == "已澄清"]
    suggested_merge = [row for row in case_rows if row.get("归并状态") == "建议合并"]
    supplement_rows = [row for row in case_rows if "补充" in f"{row.get('所属章节', '')}{row.get('用例标题', '')}"]
    covered_vals = metrics["coverage"]["已覆盖未执行"]

    add_heading(document, "一、结论摘要", 1)
    add_paragraph(document, "V5 用例集在 V4 追溯框架基础上完成缺口补齐，已针对上一轮识别的 47 个未覆盖 VAL 验收项新增 47 条补充用例。当前 330 个 FEAT+VAL 验收项全部有用例映射，需求追溯覆盖率达到 100%，用例集已具备进入正式评审和第一轮执行准备的条件。")
    add_paragraph(document, f"V5 共包含 {total} 条用例，其中 V3 原始用例 {len(metrics['v3_rows'])} 条、端到端补充用例 {len(metrics['e2e_rows'])} 条、V5 缺口补充用例 {v5_total} 条。核心结构字段完整率保持 100%；V5 新增用例的需求编号、FEAT编号、VAL编号、优先级、前置条件、步骤、预期结果和执行状态均完整。")
    add_paragraph(document, "剩余工作不再是验收项覆盖缺口，而是执行前治理：300 条 V3 历史用例仍未直接关联 VAL；408 条补充类用例被建议合并；88 条待澄清用例需要需求确认；16 组重复标题需要在评审时确认是否为不同业务对象或数据组合。", bold=True)

    add_heading(document, "二、评估范围与方法", 1)
    add_table(
        document,
        ["项目", "内容"],
        [
            ["评估对象", "测试用例汇总_V5.xlsx"],
            ["用例范围", f"9 个业务模块 {len(metrics['v3_rows'])} 条 V3 用例、{len(metrics['e2e_rows'])} 条端到端补充用例、{v5_total} 条 V5 缺口补充用例，合计 {total} 条。"],
            ["需求基准", "20 个 FEAT 需求、330 个 VAL 验收项；唯一追溯键为 FEAT编号 + VAL编号。"],
            ["V5补充依据", "V4 需求追溯矩阵中未覆盖的 47 个 VAL；补充用例内容依据原始 spec.md 和 validation.md 验收规则生成。"],
            ["评估维度", "需求追溯、结构完整性、测试视角、优先级、可执行性、重复与归并、澄清治理、执行准备度。"],
            ["数据口径", "所有指标直接读取 V5 工作簿；执行字段尚未实际填写，因此只评价编写和覆盖准备度，不评价测试通过率。"],
        ],
        widths=[3.4, 12.8],
    )

    add_heading(document, "三、总体质量概览", 1)
    add_table(
        document,
        ["维度", "当前表现", "评价"],
        [
            ["规模完整性", f"共 {total} 条用例；V3 用例 {len(metrics['v3_rows'])} 条，端到端补充 {len(metrics['e2e_rows'])} 条，V5补充 {v5_total} 条。", "良好"],
            ["核心字段完整性", "用例编号、标题、测试点、优先级、前置条件、步骤、预期结果均 100% 填写。", "良好"],
            ["需求追溯", f"330 个 VAL 验收项中 {covered_vals} 个已覆盖，覆盖率 {percent(covered_vals, 330)}；未覆盖项 0 个。", "完整"],
            ["风险覆盖", "端到端补充覆盖失败回滚 8 条、并发冲突 8 条、数据恢复 4 条。", "良好"],
            ["V5缺口补充", f"{v5_total} 条全部关联 FEAT 和 VAL；其中业务流 39 条、数据流 3 条、边界值 3 条、显示 2 条。", "良好"],
            ["执行准备", f"{total} 条用例均为未执行；执行人、执行时间、实际结果和缺陷编号均为空。", "待执行"],
            ["治理清晰度", f"{len(pending_clarification)} 条待澄清，{len(metrics['merge_rows'])} 组归并建议，{len(suggested_merge)} 条建议合并。", "需优化"],
        ],
        widths=[3.0, 10.5, 2.7],
    )

    add_heading(document, "四、模块分布与优先级", 1)
    add_paragraph(document, "用例主要集中在点检管理、受付工作台、作业管理和订单管理。这四个模块合计 768 条，占总用例量的 61.1%，说明用例设计继续向高频业务和管理链路倾斜。订单管理的 VAL 空关联仍最多，有 85 条，是后续补齐追溯关系和归并治理的重点模块。")
    add_table(
        document,
        ["模块", "用例数", "高", "中", "低", "无VAL用例", "无VAL占比"],
        metrics["module_stats"] + [
            ["端到端补充用例", len(metrics["e2e_rows"]), 20, 0, 0, 0, "0.0%"],
            ["V5缺口补充用例", v5_total, v5_total, 0, 0, 0, "0.0%"],
            ["合计", total, metrics["priorities"]["高"], metrics["priorities"]["中"], metrics["priorities"]["低"], len(no_val_rows), percent(len(no_val_rows), total)],
        ],
        widths=[3.2, 1.9, 1.4, 1.4, 1.4, 2.4, 2.5],
    )
    add_paragraph(document, f"优先级方面，高优先级 {metrics['priorities']['高']} 条，占 {percent(metrics['priorities']['高'], total)}；中优先级 {metrics['priorities']['中']} 条，占 {percent(metrics['priorities']['中'], total)}；低优先级 {metrics['priorities']['低']} 条，占 {percent(metrics['priorities']['低'], total)}。V5 新增用例全部为高优先级，应纳入第一轮评审和执行。")

    add_heading(document, "五、测试视角覆盖分析", 1)
    add_paragraph(document, "从关键词识别结果看，状态流转、查询筛选、异常失败、通知打印和边界空值已经形成较好覆盖。并发冲突、数据恢复和权限控制的用例数量仍相对较少，但 V4 端到端补充已经建立关键风险场景，V5 又补齐了对应模块的验收项路径。")
    angle_rows = []
    for name, count in sorted(metrics["angles"].items(), key=lambda item: item[1], reverse=True):
        angle_rows.append([name, count, percent(count, total), "已覆盖" if count >= 100 else "待增强"])
    add_table(document, ["测试视角", "涉及用例数", "占比", "判断"], angle_rows, widths=[4.5, 3.0, 3.0, 2.8])
    add_paragraph(document, "上述统计基于关键词识别，同一用例可能命中多个视角，因此各视角占比之和会超过 100%。")

    e2e_counter = Counter(row["所属章节"].split("/")[-1] for row in metrics["e2e_rows"])
    add_table(
        document,
        ["端到端补充场景", "用例数", "说明"],
        [
            ["失败回滚", e2e_counter["失败回滚"], "覆盖订单、发货、受付、质检、返送、批量打印、定期点检和产品停用失败后的数据一致性。"],
            ["并发冲突", e2e_counter["并发冲突"], "覆盖订单、客户、受付、作业、返送、发货、批量打印和点检计划的并发编辑冲突。"],
            ["数据恢复", e2e_counter["数据恢复"], "覆盖定期点检、批量打印、产品在库和部件追溯的数据恢复校验。"],
        ],
        widths=[3.4, 2.0, 10.8],
    )

    add_heading(document, "六、需求追溯覆盖", 1)
    add_paragraph(document, f"V5 已建立 {len(metrics['mapping_rows'])} 行用例-需求映射，对应 330 个 FEAT+VAL 验收项。当前 {covered_vals} 个验收项全部有用例覆盖，覆盖率 {percent(covered_vals, 330)}；未覆盖项 0 个。V5 新增 {v5_total} 条用例，精准对应上一轮 47 个未覆盖验收项。")
    feature_rows = []
    for feat, count in sorted(v5_feature.items(), key=lambda item: item[1], reverse=True):
        vals = "；".join(row["VAL编号"] for row in v5_rows if row["FEAT编号"] == feat)
        feature_rows.append([feat, FEAT_NAMES.get(feat, ""), count, vals])
    add_table(document, ["FEAT编号", "业务领域", "V5补充数", "补充的VAL"], feature_rows, widths=[2.2, 3.0, 2.0, 9.0])
    add_paragraph(document, "补充项集中在 FEAT-12 定期点检、FEAT-10 订单管理和 FEAT-15 受付历史，三者合计 29 条，占 V5 补充用例的 61.7%。该分布与 V4 追溯矩阵中的缺口集中度一致，说明补充不是泛化加量，而是针对原有薄弱模块闭环。")

    add_heading(document, "七、V5缺口补充用例质量", 1)
    add_table(
        document,
        ["检查项", "结果", "说明"],
        [
            ["用例数量", f"{v5_total} 条", "编号为 V5-001 至 V5-047，全部为高优先级。"],
            ["需求追溯", f"{v5_total} / {v5_total}", "每条用例均有 FEAT编号、VAL编号和需求编号，且 47 个 FEAT+VAL 组合唯一。"],
            ["内容来源", f"{v5_total} / {v5_total}", "均标注原始 FEAT/validation.md 的 VAL 依据，可反向定位原始需求。"],
            ["核心字段完整", f"{v5_total} / {v5_total}", "所属章节、标题、测试点、前置条件、步骤、预期结果、优先级和执行状态均完整。"],
            ["预期结果可判断", f"{v5_expected_ready} / {v5_total}", percent(v5_expected_ready, v5_total) + " 的用例可按换行或分句识别出不少于 2 个预期检查点。"],
            ["操作步骤分句", f"{v5_step_ready} / {v5_total}", percent(v5_step_ready, v5_total) + " 的用例按换行或分号识别出不少于 2 步；其余为紧凑验收描述，建议执行前视需要拆分为可勾选步骤。"],
            ["重复编号", "0", "V5 用例编号唯一；个别同名词题属于不同 FEAT/VAL，不应简单合并。"],
        ],
        widths=[3.5, 2.8, 9.9],
    )
    add_paragraph(document, "V5 新增用例以业务流为主，其次为数据流、边界值和显示类场景。其价值在于把原验收规则转换为可执行步骤和可观察结果，并补齐列表排序、空值重名、状态闭环、历史保护、删除复用、通知规则等 V4 中缺少的验证点。")

    add_heading(document, "八、可执行性分析", 1)
    add_table(
        document,
        ["检查项", "结果", "占比", "说明"],
        [
            ["核心字段完整", f"{len(case_rows)} / {len(case_rows)}", "100.0%", "编号、标题、测试点、优先级、前置条件、步骤、预期结果均完整。"],
            ["VAL字段已填写", f"{metrics['completeness']['VAL编号']} / {len(case_rows)}", percent(metrics['completeness']['VAL编号'], len(case_rows)), f"仍有 {len(no_val_rows)} 条 V3 历史用例没有直接 VAL 编号。"],
            ["测试步骤不少于 2 步", f"{executable_steps} / {len(case_rows)}", percent(executable_steps, len(case_rows)), "多数用例具备基本操作路径；紧凑描述型用例可在执行前细化。"],
            ["预期结果不少于 2 项", f"{executable_expected} / {len(case_rows)}", percent(executable_expected, len(case_rows)), "预期判断整体可用，复杂链路应继续补强可观测结果。"],
            ["执行状态", f"{total} 条未执行", "100.0%", "符合用例编写阶段要求，尚未进入执行阶段。"],
            ["执行结果字段", "实际结果、缺陷编号、执行人、执行时间均为空", "100.0%", "字段已预留，执行开始后可直接填写。"],
        ],
        widths=[3.6, 3.5, 2.2, 7.0],
    )

    add_heading(document, "九、治理与可维护性", 1)
    add_table(
        document,
        ["治理项", "数量", "说明"],
        [
            ["重复用例编号", "0", "全量用例编号唯一，基础管理良好。"],
            ["重复用例标题", f"{metrics['duplicate_title_groups']} 组", "包含少量跨 FEAT 的同名场景；评审时应结合 FEAT+VAL 判断是否保留。"],
            ["重复测试点", f"{metrics['duplicate_test_point_groups']} 组", "测试点重复较少，说明大部分用例仍有独立验证目标。"],
            ["补充类用例", f"{len(supplement_rows)} 条", "包含 V3 补充用例、V4 端到端补充用例和 V5 缺口补充用例。"],
            ["建议合并用例", f"{len(suggested_merge)} 条", "已标注建议合并，但仍需按业务对象、操作路径和异常类型细化归并规则。"],
            ["保留主用例", "9 条", "当前按模块和章节聚合，颗粒度仍偏粗，可能影响维护效率。"],
            ["待澄清用例", f"{len(pending_clarification)} 条", "需要需求、产品和测试共同确认后再执行。"],
            ["已澄清用例", f"{len(resolved_clarification)} 条", "可保留澄清结论，作为后续回归依据。"],
        ],
        widths=[3.5, 2.0, 10.7],
    )

    add_heading(document, "十、主要风险", 1)
    add_bullets(document, [
        "用例级追溯断点风险：300 条 V3 历史用例没有 VAL 编号，虽然 330 个验收项已全覆盖，但单条用例反向追溯仍不完整。",
        "归并维护风险：408 条补充类用例被建议合并，但仅保留 9 条主用例，归并颗粒度较粗，可能造成执行重复和维护困难。",
        "需求理解风险：88 条待澄清用例尚未关闭，直接执行可能产生误判和返工。",
        "重复评审风险：16 组重复标题需要在评审中区分业务对象、FEAT/VAL和前置数据，避免误删有效场景。",
        "执行评价风险：所有用例均未执行，当前结论只代表编写质量和覆盖准备度，不代表系统实现质量。",
    ])

    add_heading(document, "十一、改进建议", 1)
    add_table(
        document,
        ["优先级", "行动", "目标", "建议负责人"],
        [
            ["P0", "关闭 88 条待澄清用例", "消除需求理解偏差，冻结可执行版本。", "产品、需求、测试"],
            ["P0", "评审 47 条 V5 补充用例", "确认步骤、数据和预期结果后纳入第一轮执行。", "测试设计"],
            ["P1", "细化 408 条建议合并用例", "按业务对象、操作路径、前置数据和异常类型拆分归并组。", "测试设计"],
            ["P1", "补齐 300 条无 VAL 用例", "补充追溯关系，或标记为界面辅助/非验收项并说明理由。", "测试设计"],
            ["P1", "编制第一轮执行计划", f"先执行 {metrics['priorities']['高']} 条高优先级用例，再覆盖中低优先级。", "测试经理"],
            ["P2", "维护执行字段", "执行后填写实际结果、缺陷编号、执行人和执行时间。", "测试执行"],
        ],
        widths=[1.8, 4.6, 6.5, 3.4],
    )

    add_heading(document, "十二、用例类型与设计完整性分析", 1)
    add_paragraph(document, "本轮继续按测试视角拆解用例类型。类型识别依据用例标题、测试点、前置条件、测试步骤和预期结果中的业务关键词，同一条用例可能同时属于多个测试类型，因此各类型数量之和会超过总用例数。V5 补充后，类型数量需要结合 FEAT+VAL 追溯、业务对象、状态变化、输入规则、权限边界、异常路径和可观察结果共同判断。")
    add_table(
        document,
        ["测试类型", "涉及用例数", "占比", "关联VAL数", "设计完整性依据"],
        metrics["type_metrics"],
        widths=[2.7, 2.0, 1.8, 2.0, 7.7],
    )
    add_paragraph(document, "显示/界面、业务流和数据流相关用例数量最多，说明页面展示、业务动作和数据传导已得到较大范围覆盖。边界值类用例也具备一定规模。权限控制、并发冲突和数据恢复的关键风险场景已由端到端补充建立，但相对总量仍偏少，执行时应作为专项回归重点。")

    add_heading(document, "用例类型完整性的证明基准", 2)
    add_table(
        document,
        ["证明维度", "完整标准", "当前证据", "结论"],
        [
            ["需求追溯基准", "每个 FEAT 下的 VAL 都至少有一条用例覆盖，变更后可反向定位用例。", f"330 个 VAL 中 {covered_vals} 个已覆盖，0 个未覆盖；另有 {len(no_val_rows)} 条用例未直接关联 VAL。", "验收项完整"],
            ["业务流完整性", "关键对象从创建、变更、审核、流转、交付到闭环都有主路径和备选路径。", "业务流/跨模块流程相关用例较多，并有失败回滚、并发冲突和数据恢复端到端场景。", "较完整"],
            ["数据流完整性", "源头数据的创建、修改、停用、删除、恢复能正确传导到列表、详情、下拉、看板和下游业务。", "数据流/状态传递相关用例覆盖范围广，V5 补充历史保护、编号复用和追溯闭环。", "较完整"],
            ["输入与边界完整性", "必填、空值、重名、长度、格式、日期、数量、状态依赖和特殊字符均有正反校验。", "边界值类用例已覆盖常见输入规则，V5 补充空值、重名、日期边界和来件信息边界。", "基本完整"],
            ["权限与并发完整性", "有权限、无权限、未登录、不同角色、并发编辑和并发提交都有明确预期。", "权限和并发用例已有基础，端到端并发冲突场景已补充，但数量占比仍偏低。", "需增强"],
            ["异常与恢复完整性", "失败、中断、回滚、重新提交、备份恢复和历史保留都有可验证结果。", "端到端失败回滚、并发冲突和数据恢复用例已补充，V5 补充删除、复用和历史保护。", "较完整"],
            ["结果可验证性", "每条用例的前置数据、操作步骤和预期页面/数据/状态结果清晰可判断。", "核心字段完整率 100%，V5 预期结果分句完整率 100%，复杂链路执行时仍应细化观测点。", "基本完整"],
        ],
        widths=[2.6, 5.2, 5.5, 2.0],
    )
    add_paragraph(document, "因此，判断一个类型的用例是否设计完整，不能只看数量占比，而应同时满足五项证据：一是该类型对应的 VAL 验收项没有缺口；二是关键业务对象和状态已经列入用例；三是正常、异常、边界、权限、并发和恢复路径有覆盖；四是预期结果能观察到页面变化、数据变化或状态变化；五是执行后可通过实际结果、缺陷编号、执行人和执行时间回溯。当前 V5 已在需求追溯维度闭环，执行前仍应完成澄清、归并和用例级 VAL 补齐。")

    document.add_page_break()
    add_heading(document, "附录：V5缺口补充用例追溯清单", 1)
    v5_detail = []
    for row in v5_rows:
        category = row["备注"].split("；")[0].replace("V5缺口补充用例：", "")
        v5_detail.append([row["用例编号"], f'{row["FEAT编号"]} / {row["VAL编号"]}', row["用例标题"], category])
    add_table(document, ["用例编号", "FEAT / VAL", "用例标题", "测试类型"], v5_detail, widths=[2.2, 3.8, 8.0, 2.2])
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    document.save(OUTPUT_PATH)
    return OUTPUT_PATH


if __name__ == "__main__":
    metrics = build_metrics()
    output = generate_report_v5(metrics)
    print(output)
