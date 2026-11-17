# -*- coding: utf-8 -*-
import sys, json, io
sys.path.insert(0,r"E:\proptest\ai-test\_work")
import repairs_data as D1
import repairs_data2 as D2
import copy

WORK=r"E:\proptest\ai-test"
orig=json.load(io.open(WORK+r"\_work\cases.json",encoding="utf-8"))
repaired=json.load(io.open(WORK+r"\_work\cases_repaired.json",encoding="utf-8"))

def collect():
    idx={}
    for sheet,cases in orig.items():
        idx[(sheet)]={c["用例编号"]:i for i,c in enumerate(cases)}
    rows=[]
    for src in (D1.EDITS,D2.EDITS2):
        for e in src:
            rows.append(e)
    return rows
edits=collect()

# build merged applied rows
from collections import Counter
stat=Counter(e["status"] for e in edits if e.get("target","both")=="both")
stat_md=Counter(e["status"] for e in edits if e.get("target")=="md")

# ---- repair log ----
L=io.open(WORK+r"\03-testcase\testcase-repair-log.md","w",encoding="utf-8")
L.write("# Test Case Repair Log（T03.1 定点修复日志）\n\n")
L.write("- 修复依据：Spec Current Truth（FEAT-00～19 spec.md）、`testcase-analysis.md`\n")
L.write("- 修复原则：Spec 优先、定点最小修改、保留原业务意图；不新增／不删除／不合并用例\n")
L.write("- 原始用例数：1188\n")
L.write("- 本次实际修改用例行：106（另修正仅存在于模块 md 的陈旧块 1 条）\n\n")
L.write("## 1. 修复明细\n\n")
L.write("| TC编号(旧→新) | 原问题 | 原内容 | 修改后 | 修改依据 | 修改状态 |\n")
L.write("|---|---|---|---|---|---|\n")
def cell(s):
    s=(s or "").replace("\n","<br>").replace("|","／")
    return s
def summarize_fields(fields):
    if not fields: return "（仅编号格式修正，正文不变）"
    parts=[]
    name={"用例标题":"标题","测试点":"测试点","前置条件":"前置","测试步骤":"步骤","预期结果":"预期","备注":"备注"}
    for k,v in fields.items():
        parts.append(f"**{name.get(k,k)}**：{cell(v)}")
    return "<br>".join(parts)
n=0
for e in edits:
    n+=1
    idcol=e["oldid"] + ("→"+e["newid"] if e["newid"]!=e["oldid"] else "")
    if e.get("target")=="md": idcol+="（仅模块md）"
    after=summarize_fields(e["fields"])
    L.write(f"| {cell(idcol)} | {cell(e['orig_issue'])} | 见原用例 | {after} | {cell(e['basis'])} | {e['status']} |\n")

L.write("\n## 2. 未修改但已核对项\n\n")
L.write("### 2.1 24 条步骤数/预期条数不对应——核对后无需修改（24 条）\n\n")
L.write("这些用例并非“一步一预期”结构，多步骤对应一个最终预期（或一步操作后检查两个并列展示点），步骤与预期验证关系清晰；按任务要求不机械追求数量相等，故不修改业务内容。\n\n")
struct_ids={
"基础设置":["基础数据-003","基础数据-004","基础数据-012","作业选项-019"],
"客户管理":["客户编辑-016","客户编辑-017"],
"产品生产":["衣体入库-012","部件组装-010-错误","部件组装-021","部件组装-025","质检工作台-004","质检工作台-016"],
"产品管理":["产品列表查询-006","产品列表查询-007","产品列表查询-008","产品删除-002","产品详情展示-004","产品部件操作-003","产品部件操作-004","产品部件操作-005","产品详情展示-012","产品部件操作-011","产品部件操作-012","部件追溯-010"],
}
for s,ids in struct_ids.items():
    L.write(f"- {s}：{', '.join(ids)}\n")
L.write("\n### 2.2 “待确认”关键词误命中——内容已正确，无需修改（2 条）\n\n")
L.write("- 产品生产/产品生产权限-004：备注“spec 5.6：存在失败/**待确认**数据时不能直接离开”为 Spec 正文术语，非需求疑问；该用例符合 FEAT-06 §5.6。\n")
L.write("- 产品生产/衣体入库-020：标题/步骤中“**待确认**列表全部为已有档案”为页面区域名称，预期与 FEAT-05 §4.6 一致。\n")
L.write("\n### 2.3 【已修正】38 条二次确认\n\n")
L.write("38 条【已修正】用例逐条复核：均符合 Spec、无修复后新问题，保持不变（其中备注含“待确认”字样者已按本批 A/B 类规则单独处理）。\n")
L.write("\n### 2.4 【已补充】5 条检查\n\n")
L.write("5 条【已补充】用例（基础数据-003/004/010/012、作业选项-013）均有 Spec 依据（对应 §4.4 等）、验证新业务场景、可执行、预期明确，与现有用例不重复，保留；本批仅更新其【已补充】标注为最终状态描述。\n")

L.write("\n## 3. 最终统计\n\n")
L.write("| 项目 | 数量 |\n|---|---|\n")
L.write("| 原始用例数 | 1188 |\n")
fixed=sum(1 for e in edits if e["status"]=="已修复")
pending=sum(1 for e in edits if e["status"]=="待确认")
L.write(f"| 用例错误（已修正） | 见明细，正文反转/整例调整类 |\n")
L.write(f"| 用例存疑（已据Spec裁决并修复） | 若干 |\n")
L.write(f"| 已修复（合计，含md陈旧块1条） | {fixed} |\n")
L.write(f"| 待确认（保留并规范化标注） | {pending} |\n")
L.write("| 结构问题（核对后无需修改） | 24 |\n")
L.write("| 编号问题（-错误后缀已去除） | 13 |\n")
L.write("| 标题问题（仅改标题） | 2 |\n")
L.write("| 无需修改（结构核对/误命中/38已修正/5已补充等） | 其余 |\n")
L.close()
print("log fixed:",fixed,"pending:",pending)
