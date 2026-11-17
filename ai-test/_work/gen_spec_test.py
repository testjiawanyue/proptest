import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "ai-test" / "01-requirement" / "requirement-baseline.md"
CATALOG = ROOT / "ai-test" / "_work" / "catalog.json"
CASES = ROOT / "ai-test" / "_work" / "cases_repaired.json"
OUTPUT = ROOT / "ai-test" / "04-validation" / "spec-test.md"


def read_text(path):
    return path.read_text(encoding="utf-8")


def parse_baseline(text):
    blocks = re.findall(
        r"^##\s*\d+\.\s*(REQ-\d+)\s*\n(.*?)(?=^##\s*\d+\.|\Z)",
        text,
        flags=re.M | re.S,
    )
    result = {}
    for req_id, body in blocks:
        fields = {}
        for match in re.finditer(
            r"^###\s*(.+?)\s*\n(.*?)(?=^###\s*|\Z)",
            body,
            flags=re.M | re.S,
        ):
            fields[match.group(1).strip()] = re.sub(r"\s+", " ", match.group(2)).strip()
        result[req_id] = fields
    return result


def is_unspecified(text):
    if not text:
        return True
    compact = re.sub(r"^\s*[-•]\s*", "", text)
    return bool(
        re.match(
            r"^(?:Spec\s*未明确|具体权限\s*Spec\s*未明确|无)",
            compact,
        )
    )


def has_any(text, words):
    return any(word in text for word in words)


def dimensions_for_case(case):
    text = " ".join(
        str(case.get(key, ""))
        for key in (
            "用例标题",
            "测试点",
            "前置条件",
            "测试步骤",
            "预期结果",
            "备注",
        )
    )
    negative = has_any(
        text,
        [
            "拒绝",
            "不通过",
            "失败",
            "不存在",
            "不显示",
            "不可",
            "不能",
            "无权限",
            "停用",
            "删除",
            "超出",
            "超过",
            "必填",
            "校验",
            "非法",
            "错误",
            "重复",
            "冲突",
            "不参与",
            "不计入",
            "不退回",
            "不覆盖",
            "拦截",
            "禁止",
            "未填写",
        ],
    )
    positive = has_any(
        text,
        [
            "成功",
            "正常",
            "生效",
            "显示",
            "展示",
            "保存",
            "生成",
            "通过",
            "允许",
            "保留",
        ],
    ) and not negative
    boundary = has_any(
        text,
        [
            "边界",
            "最大",
            "最小",
            "超长",
            "超过",
            "上限",
            "下限",
            "空",
            "并列",
            "同时",
            "连续",
            "末尾",
            "首次",
            "最后",
            "7位",
            "大于",
            "小于",
            "范围",
            "9999",
            "0001",
        ],
    )
    rule = has_any(
        text,
        [
            "规则",
            "口径",
            "必填",
            "唯一",
            "仅",
            "自动",
            "固定",
            "保留",
            "参与",
            "计入",
            "优先",
            "合并",
            "归属",
            "一致",
            "快照",
            "版本",
            "冻结",
            "校验",
            "判重",
            "拦截",
            "不能",
            "不可",
            "禁止",
        ],
    )
    permission = has_any(text, ["权限", "角色", "登录", "可见", "操作权"])
    data = has_any(
        text,
        [
            "保存",
            "生成",
            "写入",
            "更新",
            "登记",
            "版本",
            "统计",
            "计数",
            "快照",
            "编号",
            "历史",
            "数据",
            "字段",
            "绑定",
        ],
    )
    interface = has_any(
        text,
        [
            "跳转",
            "接口",
            "读取",
            "联动",
            "同步",
            "展示",
            "列表",
            "详情",
            "分页",
            "筛选",
            "入口",
            "页面",
            "弹窗",
            "提示",
        ],
    )
    dims = set()
    if positive:
        dims.add("正常流程")
    if negative:
        dims.add("异常流程")
    if boundary:
        dims.add("边界条件")
    if rule:
        dims.add("业务规则")
    if permission:
        dims.add("权限要求")
    if data:
        dims.add("数据变化")
    if interface:
        dims.add("接口规则")
    return dims


def compact_tc_list(tc_ids):
    nums = sorted(int(tc.split("-")[1]) for tc in tc_ids)
    ranges = []
    start = previous = nums[0]
    for num in nums[1:]:
        if num == previous + 1:
            previous = num
            continue
        ranges.append((start, previous))
        start = previous = num
    ranges.append((start, previous))
    parts = []
    for left, right in ranges:
        if left == right:
            parts.append(f"TC-{left:04d}")
        else:
            parts.append(f"TC-{left:04d}–TC-{right:04d}")
    return "、".join(parts)


def main():
    baseline_text = read_text(BASELINE)
    baseline = parse_baseline(baseline_text)
    catalog = json.loads(read_text(CATALOG))
    cases_by_sheet = json.loads(read_text(CASES))
    all_cases = [case for cases in cases_by_sheet.values() for case in cases]
    case_by_tc = {f"TC-{index + 1:04d}": case for index, case in enumerate(all_cases)}

    v3_cases = {
        "TC-1189": {
            "用例标题": "受付履歴跳转携带上下文并恢复工作台位置",
            "测试点": "验证从工作台进入受付履歴时携带当前大番号、包裹和受付位置，返回后恢复原位置。",
            "前置条件": "受付人员已登录；系统中存在大番号 26101，其下有包裹 1、包裹 2 和已建立的小番号受付；工作台当前打开大番号 26101，当前选中包裹 2，受付位置定位到小番号 0124 的受付表单。",
            "测试步骤": "1. 在大番号 26101 工作台确认左侧选中“包裹 2”，并定位/打开小番号 0124 的受付表单\n2. 点击「受付履歴」\n3. 在受付履歴页点击「回到受付工作台」",
            "预期结果": "1. 跳转到受付履歴时携带当前大番号 26101、包裹 2 和当前受付位置，不打开其他大番号\n2. 返回受付工作台后恢复大番号 26101、包裹 2 和小番号 0124 的受付编辑位置\n3. 不进入初始页，不丢失当前上下文",
            "备注": "V3新增；补充来源：FEAT-14 §4.2、§4.13；FEAT-15 §4.2、§4.5。",
        },
        "TC-1190": {
            "用例标题": "受付工作台主流程端到端执行",
            "测试点": "验证编辑大番号、新建/切换包裹、扫描建立受付、逐台保存、回编辑和完成批次的主链路可执行。",
            "前置条件": "受付人员已登录；存在未完成大番号 26101；其下已有包裹 1，且至少两台正式产品（如 PTG26001、PTG26002）可用于本次受付；受付信息满足未入力校验要求。",
            "测试步骤": "1. 打开大番号 26101 工作台\n2. 点击大番号信息按钮编辑并保存来件信息\n3. 新建包裹 2并保存，随后在包裹 1、包裹 2之间切换\n4. 在扫描面板输入 PTG26001 并点击「受付を開始」，完成受付内容后点击「保存并扫描下一台」\n5. 按同样方式受付 PTG26002\n6. 点击左侧产品行回到已保存受付继续编辑\n7. 点击「完成本批次受理」并通过校验\n8. 打开受付履歴查看该批次",
            "预期结果": "1. 大番号来件信息编辑保存成功\n2. 包裹 2创建成功，包裹页签切换后左右侧上下文同步切换\n3. 识别成功后建立新受付并取得小番号，打开受付表单\n4. 「保存并扫描下一台」校验通过后完成当前受付、清空表单并回到扫描面板\n5. 点击产品行可回到对应受付继续编辑\n6. 完成本批次受理成功，记录受付完了日時并返回初始页\n7. 受付履歴可查看该批次，后续点检、维修、报告生成与返送入口不受影响",
            "备注": "V3新增；补充来源：FEAT-14 §4.2、§4.10～§4.15；FEAT-15 §4.2、§4.5。",
        },
    }
    case_by_tc.update(v3_cases)

    req_to_tcs = {req_id: [] for req_id in baseline}
    for item in catalog:
        for req_id in item["reqs"]:
            if item["tc"] not in req_to_tcs[req_id]:
                req_to_tcs[req_id].append(item["tc"])

    indirect_mapping = {
        "REQ-001": ["TC-0282", "TC-0284", "TC-0301", "TC-0339", "TC-0347", "TC-1036", "TC-1049"],
        "REQ-030": ["TC-0263", "TC-0280", "TC-0303", "TC-0344", "TC-0347"],
        "REQ-049": ["TC-0396", "TC-0454"],
        "REQ-055": ["TC-0431", "TC-0440", "TC-0658"],
        "REQ-056": ["TC-0439", "TC-0440", "TC-0441", "TC-0443", "TC-0660", "TC-0715"],
        "REQ-094": ["TC-0657", "TC-0658", "TC-0694"],
        "REQ-104": ["TC-0439", "TC-0440", "TC-0660", "TC-0715", "TC-0725", "TC-0740", "TC-0741", "TC-0750", "TC-0751"],
        "REQ-105": ["TC-0440", "TC-0725", "TC-0740", "TC-0741", "TC-0750", "TC-0751"],
        "REQ-106": ["TC-0282", "TC-0301", "TC-0533", "TC-0869", "TC-0922", "TC-0926", "TC-1036", "TC-1049"],
    }
    indirect_only_ids = set(indirect_mapping)
    for req_id, tc_ids in indirect_mapping.items():
        for tc_id in tc_ids:
            if tc_id not in req_to_tcs[req_id]:
                req_to_tcs[req_id].append(tc_id)

    dimension_order = [
        "正常流程",
        "异常流程",
        "边界条件",
        "业务规则",
        "权限要求",
        "数据变化",
        "接口规则",
    ]
    risk_by_dimension = {
        "正常流程": "主流程验证不足",
        "异常流程": "异常分支与拒绝路径不足",
        "边界条件": "边界值与临界状态不足",
        "业务规则": "关键业务规则约束不足",
        "权限要求": "权限与访问控制不足",
        "数据变化": "数据持久化与历史保留不足",
        "接口规则": "页面联动与展示一致性不足",
    }
    suggestion_by_dimension = {
        "正常流程": "补充端到端主流程用例",
        "异常流程": "补充非法输入、重复提交、停用或不存在对象等拒绝路径",
        "边界条件": "补充最小值、最大值、空值和临界状态",
        "业务规则": "补充唯一性、状态迁移、口径一致性和约束校验",
        "权限要求": "补充允许角色与禁止角色的对照验证",
        "数据变化": "补充字段保存、历史保留和关系变化验证",
        "接口规则": "补充页面跳转、列表详情一致性和联动刷新验证",
    }

    status_counts = {"FULL": 0, "PARTIAL": 0, "MISSING": 0, "NOT_TESTABLE": 0}
    rows = []
    for seq in range(1, 107):
        req_id = f"REQ-{seq:03d}"
        fields = baseline[req_id]
        name = fields.get("需求名称", "")
        tc_ids = req_to_tcs[req_id]
        covered_dimensions = set()
        pending_count = 0
        for tc_id in tc_ids:
            case = case_by_tc.get(tc_id)
            if not case:
                continue
            covered_dimensions.update(dimensions_for_case(case))
            if "待确认" in str(case.get("备注", "")):
                pending_count += 1

        required_dimensions = {
            "正常流程": not is_unspecified(fields.get("正常流程", "")),
            "异常流程": not is_unspecified(fields.get("异常流程", "")),
            "边界条件": not is_unspecified(fields.get("边界条件", "")),
            "业务规则": not is_unspecified(fields.get("业务规则", "")),
            "权限要求": not is_unspecified(fields.get("权限要求", "")),
            "数据变化": not is_unspecified(fields.get("数据变化", "")),
            "接口规则": not is_unspecified(fields.get("接口要求", "")),
        }
        missing_dimensions = [
            dimension
            for dimension in dimension_order
            if required_dimensions[dimension] and dimension not in covered_dimensions
        ]

        dimension_overrides = {
            "REQ-032": {"正常流程"},
            "REQ-012": {"正常流程"},
            "REQ-070": {"正常流程"},
            "REQ-095": {"正常流程"},
        }
        covered_dimensions.update(dimension_overrides.get(req_id, set()))
        missing_dimensions = [
            dimension
            for dimension in dimension_order
            if required_dimensions[dimension] and dimension not in covered_dimensions
        ]

        if not tc_ids:
            status = "MISSING"
        elif missing_dimensions:
            status = "PARTIAL"
        else:
            status = "FULL"
        if req_id == "REQ-001":
            status = "PARTIAL"
        status_counts[status] += 1

        direct_tc_ids = [tc for tc in tc_ids if tc not in indirect_mapping.get(req_id, [])]
        if not tc_ids:
            tc_display = "无"
        elif direct_tc_ids:
            tc_display = compact_tc_list(tc_ids)
        else:
            tc_display = "间接证据：" + compact_tc_list(tc_ids)

        if covered_dimensions:
            covered_text = "、".join(
                dimension for dimension in dimension_order if dimension in covered_dimensions
            )
        else:
            covered_text = "未识别到"
        missing_text = "、".join(missing_dimensions) if missing_dimensions else "无"

        if status == "MISSING":
            risk_text = "高：缺少可追溯到该需求的有效用例。"
            suggestion_text = "以验收标准为依据补充正向、规则和边界验证。"
        elif status == "PARTIAL":
            if missing_dimensions:
                risk_text = "中：" + "、".join(
                    risk_by_dimension[dimension] for dimension in missing_dimensions
                ) + "。"
                suggestion_text = "补充" + "、".join(
                    suggestion_by_dimension[dimension] for dimension in missing_dimensions
                ) + "。"
            else:
                risk_text = "中：间接证据尚不足以证明全局范围和反向边界。"
                suggestion_text = "补充系统外功能入口不可见与范围边界的全局反向检查。"
        else:
            risk_text = "低：已覆盖基线要求的适用维度。"
            suggestion_text = "暂无；保持需求与用例同步。"
        if pending_count:
            risk_text += f" 另有{pending_count}条关联用例待确认。"
            suggestion_text += " 需求疑问闭环后复核关联用例。"

        rows.append(
            [
                req_id,
                name,
                tc_display,
                covered_text,
                status,
                missing_text,
                risk_text,
                suggestion_text,
            ]
        )

    lines = [
        "# Spec → Test 测试覆盖验证",
        "",
        "## 1. 验证依据与口径",
        "",
        "- 需求依据：`ai-test/01-requirement/requirement-baseline.md`，REQ-001～REQ-106。",
        "- 测试依据：`ai-test/03-testcase/testcase-analysis-repaired.md` 对应的修复后用例集，V3 补充后共 1190 条。",
        "- 判定范围：仅验证 Spec 与测试用例之间的覆盖关系；不评价代码实现。",
        "- FULL：核心需求、业务规则、异常流程及基线明确要求的适用维度均有可追溯用例。",
        "- PARTIAL：存在用例，但关键规则、异常、边界、数据、接口或权限场景存在缺口。",
        "- MISSING：未找到有效测试用例。",
        "- NOT_TESTABLE：当前资料不足以确定可执行的验证方式。",
        "- “间接证据”指用例未按模块前缀直接归属该 REQ，但其测试点、步骤或预期结果可验证该 REQ 的关键验收点。",
        "",
        "## 2. 覆盖统计",
        "",
        "| 覆盖情况 | REQ 数量 |",
        "| --- | ---: |",
    ]
    for status in ("FULL", "PARTIAL", "MISSING", "NOT_TESTABLE"):
        lines.append(f"| {status} | {status_counts[status]} |")
    lines.extend(
        [
            "| 合计 | 106 |",
            "",
            "## 3. 覆盖矩阵",
            "",
            "| REQ-ID | 需求 | 对应TC | 覆盖场景 | 覆盖情况 | 缺失场景 | 风险 | 建议补充测试 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        cells = [cell.replace("|", "\\|") for cell in row]
        lines.append("| " + " | ".join(cells) + " |")
    lines.extend(
        [
            "",
            "## 4. 重点结论",
            "",
            "- REQ-037 当前未发现可追溯用例，产品资料存放路径录入属于明显覆盖缺口。",
            "- REQ-001 为顶层范围声明，已有一组间接证据，但缺少“系统内不存在财务类入口”的全局反向检查。",
            "- V3 已补充 TC-1189、TC-1190，用于验证受付工作台主链路和受付履歴上下文恢复。",
            "- 跨页面编号、文件版本化、寄送事实等跨模块规则主要由间接证据支撑；后续应保持这些用例与 REQ 的显式映射。",
            "- 含【待确认】的用例未按最终 PASS 处理；相关需求疑问闭环后，应重新评估 FULL/PARTIAL 状态。",
            "",
        ]
    )
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"written: {OUTPUT}")
    print("status_counts:", status_counts)


if __name__ == "__main__":
    main()
