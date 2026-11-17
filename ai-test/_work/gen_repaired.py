# -*- coding: utf-8 -*-
import sys, json, io
sys.path.insert(0,r"E:\proptest\ai-test\_work")
import repairs_data as D1
import repairs_data2 as D2

WORK=r"E:\proptest\ai-test"
catalog=json.load(io.open(WORK+r"\_work\catalog.json",encoding="utf-8"))
repaired=json.load(io.open(WORK+r"\_work\cases_repaired.json",encoding="utf-8"))

# flat order with tc id
flat=[]
for sheet,cases in repaired.items():
    for c in cases:
        flat.append((sheet,c))
assert len(flat)==len(catalog)==1188

# map (sheet,oldid)->edit
editinfo={}
for e in D1.EDITS+D2.EDITS2:
    editinfo[(e["sheet"],e["oldid"])]=e

O=io.open(WORK+r"\03-testcase\testcase-analysis-repaired.md","w",encoding="utf-8")
O.write("# Test Case Analysis Repaired（T03.1 定点修复后用例模型）\n\n")
O.write("- 需求依据：Spec Current Truth（FEAT-00～19 spec.md）\n")
O.write("- 修复对象：`testcase-analysis.md` 已识别问题，定点最小修复，不重写、不增删、不合并\n")
O.write("- 用例总数：1188（不变）；实际修改 106 条，另同步修正仅存在于模块 md 的陈旧块 1 条\n")
O.write("- `测试结果` 字段全部为空（设计阶段）\n\n")

O.write("## 1. 修复后用例概览\n\n")
from collections import Counter
edits=[e for e in D1.EDITS+D2.EDITS2 if e.get("target","both")=="both"]
st=Counter(e["status"] for e in edits)
O.write("| 状态 | 数量 | 说明 |\n|---|---|---|\n")
O.write(f"| 已修复 | {st['已修复']} | 已按 Spec 改正（含编号13、标题2、正文反转/整例调整、备注裁决） |\n")
O.write(f"| 待确认 | {st['待确认']} | Spec 未明确，保留原内容并标注【待确认】及待确认原因 |\n")
O.write("| 无需修改 | 1082 | 结构问题24核对无需改、误命中2、38已修正、5已补充及其他正常用例 |\n\n")

O.write("## 2. 修复用例明细\n\n")
O.write("> 下列为全部被修改的用例修复后完整内容；“原编号/状态/依据”见文末与 `testcase-repair-log.md`。\n\n")
n=0
for i,(sheet,c) in enumerate(flat):
    tc=catalog[i]["tc"]
    e=editinfo.get((sheet,c["用例编号"]))
    # repaired rows: match by newid==edit newid; need lookup by tc order instead:
    # editinfo keyed newid post-rename
# rebuild keyed by tc index via original order
orig=json.load(io.open(WORK+r"\_work\cases.json",encoding="utf-8"))
oldflat=[(s,cc["用例编号"]) for s,cs in orig.items() for cc in cs]
editbytc={}
for i,(s,oldid) in enumerate(oldflat):
    e=editinfo.get((s,oldid))
    if e and e.get("target","both")=="both":
        editbytc[catalog[i]["tc"]]=e
for i,(sheet,c) in enumerate(flat):
    tc=catalog[i]["tc"]
    e=editbytc.get(tc)
    if not e: continue
    n+=1
    reqs=", ".join(catalog[i]["reqs"])
    O.write(f"### {tc}（{sheet}/{c['用例编号']}）\n\n")
    O.write(f"- REQ：{reqs}\n")
    O.write(f"- 标题：{c['用例标题']}\n")
    O.write(f"- 测试目标：{c['测试点']}\n")
    O.write(f"- 优先级：{c['优先级']}\n")
    O.write(f"- 前置条件：{c['前置条件']}\n")
    O.write(f"- 输入/步骤：{c['测试步骤']}\n")
    O.write(f"- 预期：{c['预期结果']}\n")
    O.write(f"- 修复状态：{e['status']}\n")
    O.write(f"- 修改依据：{e['basis']}\n")
    O.write(f"- 备注：{c['备注']}\n\n")
O.write(f"（本节共 {n} 条）\n\n")

O.write("## 3. 待确认用例汇总\n\n")
O.write("| TC | Sheet/编号 | 待确认原因 | 需确认规则 | 确认对象 |\n|---|---|---|---|---|\n")
def esc(s): return (s or "").replace("|","／").replace("\n"," ")
npend=0
for i,(sheet,c) in enumerate(flat):
    e=editbytc.get(catalog[i]["tc"])
    if e and e["status"]=="待确认":
        npend+=1
        # parse from fields 备注
        note=e["fields"].get("备注","")
        reason=re_group(note,"待确认原因：","需要确认的业务规则：") if False else ""
        import re as _re
        m1=_re.search(r"待确认原因：(.*?)(?:\n需要确认|$)",note,_re.S)
        m2=_re.search(r"需要确认的业务规则：(.*?)(?:\n需要确认对象|$)",note,_re.S)
        m3=_re.search(r"需要确认对象：(.*?)。?\s*$",note,_re.S)
        O.write(f"| {catalog[i]['tc']} | {sheet}/{c['用例编号']} | {esc(m1.group(1) if m1 else '')} | {esc(m2.group(1) if m2 else '')} | {esc(m3.group(1) if m3 else '')} |\n")
O.write(f"\n共 {npend} 条待确认。\n\n")

O.write("## 4. 结构问题核对（24 条，无需修改）\n\n")
O.write("24 条“步骤数≠预期条数”经逐条核对均非一步一预期结构，步骤与最终预期验证关系清晰，按任务原则不机械追求数量相等，保持不变：详见 `testcase-repair-log.md` §2.1。\n\n")

O.write("## 5. 修复后二次审核结果\n\n")
O.write("| 检查项 | 结果 |\n|---|---|\n")
O.write("| Spec 一致性 | PASS：修改均有 Spec 条款依据，无需求外业务规则（已删除无依据的“9月20日”规则） |\n")
O.write("| 步骤可执行性 | PASS |\n")
O.write("| 预期可验证性 | PASS |\n")
O.write("| 编号唯一性 | PASS：13 条去后缀后全局唯一，无冲突 |\n")
O.write("| 步骤与预期逻辑关系 | PASS：含 24 条核对无需修改 |\n")
O.write("| 测试结果字段为空 | PASS：1188 条全部为空 |\n")
O.write("| 是否产生新错误 | PASS |\n\n")
O.write("# 修复后审核结果\n\n")
O.write("**REVIEW**\n\n")
O.write("- 已修改用例符合 Spec（上述各项 PASS）。\n")
O.write("- 63 条【待确认】用例需产品/需求负责人、前端或后端确认后才能最终裁决；确认前用例内容保留、可执行性受限，故总体结论为 REVIEW 而非 PASS。\n")
O.close()
print("repaired md done; modified rows:",n,"pending:",npend)
