import json, re
from collections import Counter

with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)
with open(r"E:\proptest\ai-test\_work\part12.md", encoding="utf-8") as f:
    part12 = f.read()

M = {
 "基础设置": {"部件资料":["REQ-018","REQ-019"],"部件资料版本":["REQ-018"],"基础数据":["REQ-020","REQ-021","REQ-022"],"作业选项":["REQ-023","REQ-024"]},
 "客户管理": {"客户列表查询":["REQ-013"],"公司维护":["REQ-009"],"支店现场维护":["REQ-010"],"客户编辑":["REQ-015"],"客户删除":["REQ-010","REQ-011","REQ-012"],"客户详情跳转":["REQ-014"],"客户联动跳转":["REQ-014"],"客户更正履历":["REQ-015"],"客户权限":["REQ-014","REQ-016"],"客户主体选择":["REQ-016"],"客户回归":["REQ-017"]},
 "产品生产": {"衣体入库":["REQ-025"],"部件组装":["REQ-026","REQ-027"],"质检工作台":["REQ-028"],"产品生产权限":["REQ-028"]},
 "产品管理": {"产品列表查询":["REQ-031"],"产品列表数据关联":["REQ-031"],"产品删除":["REQ-032"],"产品详情展示":["REQ-029","REQ-035","REQ-036"],"产品部件操作":["REQ-033","REQ-034"],"部件追溯":["REQ-038","REQ-039","REQ-040"],"产品管理权限":["REQ-031"]},
 "订单管理": {"订单列表查询":["REQ-044"],"新建订单":["REQ-041","REQ-042","REQ-043","REQ-048"],"订单详情":["REQ-045","REQ-050"],"订单编辑":["REQ-048"],"订单取消":["REQ-046"],"发货管理":["REQ-051","REQ-052","REQ-053","REQ-054"],"解除产品关联":["REQ-047"],"批量打印面单":["REQ-103"],"订单权限":["REQ-044"],"订打补充":["REQ-103"]},
 "点检管理": {"生命周期建立":["REQ-059"],"定期管理":["REQ-060","REQ-061"],"通知建立":["REQ-057","REQ-058","REQ-062"],"通知版本":["REQ-057"],"受付情况查看":["REQ-063"],"通知管理":["REQ-064","REQ-065"],"返送管理":["REQ-095"],"返送补充":["REQ-096","REQ-097","REQ-098","REQ-099","REQ-100","REQ-101"],"返打补充":["REQ-102"]},
 "受付工作台": {"大番号建立":["REQ-066"],"包裹登记":["REQ-067"],"产品受付":["REQ-068"],"临时来件受付":["REQ-069"],"正式NG登记":["REQ-075"],"受付作业边界":["REQ-076"],"大番号完成":["REQ-070"],"工作台补充":["REQ-071","REQ-072","REQ-073","REQ-074"],"履歴补充":["REQ-077","REQ-078","REQ-079"],"受付履历查询":["REQ-077"],"批次记录表":["REQ-078"]},
 "作业管理": {"作业列表查询":["REQ-081"],"专业作业记录":["REQ-080"],"任务流边界":["REQ-080"],"部件更换拆除":["REQ-085","REQ-086","REQ-088"],"报告生成":["REQ-089"],"报告版本修正":["REQ-090"],"最终处理":["REQ-091"],"作业补充":["REQ-082","REQ-083","REQ-084","REQ-087","REQ-092","REQ-093"]},
 "首页看板": {"页面展示":["REQ-008"],"订单一览":["REQ-002"],"待办事项":["REQ-003"],"厂内作业":["REQ-004"],"今日作业":["REQ-005"],"厂内库存":["REQ-006"],"半成品":["REQ-007"],"页面跳转":["REQ-008"]},
}

def prefix_of(tcid):
    return re.sub(r"-\d{3}(-错误)?$","",tcid)

catalog=[]
g=0
for sheet, items in data.items():
    for d in items:
        g+=1
        tcid=d.get("用例编号","")
        pref=prefix_of(tcid) if tcid else ""
        reqs=M.get(sheet,{}).get(pref,[])
        catalog.append((g,sheet,tcid,reqs,d))

# ---------- Part 3: issues ----------
L=[]; A=L.append
A("## 3. 测试用例问题")
A("")
A("> 问题来源：① 备注中既有审核标注（用例错误/用例存疑）；② 本次自动化结构检查；③ Spec 一致性核对。")
A("> 每条含：问题、影响、对应 TC、对应 REQ。严重级：P0=整例与 Spec 相反/不成立；P1=预期需修正；P2=结构/可执行性瑕疵。")
A("")

issues=[]

# Build the 25 error issues + 6 doubt issues from notes
for g2,sheet,tcid,reqs,d in catalog:
    note=d.get("备注","")
    if "【用例错误】" in note:
        body=note.split("【用例错误】",1)[1].strip()
        issues.append(("P0",d.get("用例标题",""),body,f"TC-{g2:04d}（{sheet}/{tcid}）",", ".join(reqs) if reqs else "—"))
    elif "【用例存疑】" in note:
        body=note.split("【用例存疑】",1)[1].strip()
        issues.append(("P1",d.get("用例标题",""),body,f"TC-{g2:04d}（{sheet}/{tcid}）",", ".join(reqs) if reqs else "—"))

# structural issues
struct=[]
for g2,sheet,tcid,reqs,d in catalog:
    steps=d.get("测试步骤",""); exp=d.get("预期结果","")
    sn=len(re.findall(r"(?m)^\s*\d+[\.、]",steps))
    en=len(re.findall(r"(?m)^\s*\d+[\.、]",exp))
    if sn and en and sn!=en:
        struct.append(("P2",f"步骤数{sn}与预期条数{en}不对应","逐步可验证性下降，执行时无法逐条核对预期",f"TC-{g2:04d}（{sheet}/{tcid}）",", ".join(reqs) if reqs else "—"))
    if tcid and not re.match(r"^.+?-\d{3}$",tcid):
        struct.append(("P2",f"编号格式偏离约定（{tcid}）","不符合 `<功能点>-<NNN>` 规则，编号检索/排序可能异常",f"TC-{g2:04d}（{sheet}/{tcid}）",", ".join(reqs) if reqs else "—"))
issues.extend(struct)

for i,(sev,title,body,loc,req) in enumerate(issues,1):
    iid=f"ISSUE-TC-{i:03d}"
    A(f"### {iid}")
    A("")
    A(f"- 级别：{sev}")
    A(f"- 问题：{title}")
    A(f"- 说明：{body}")
    impact = {
        "P0":"用例结论会误导验收，可能将与 Spec 相反的行为判为通过；需停用或按备注指引改正。",
        "P1":"存在歧义，未裁决前执行结果不可判定；需产品/后端确认。",
        "P2":"不影响业务正确性，但降低可执行性与规范性；建议修订。",
    }[sev]
    A(f"- 影响：{impact}")
    A(f"- 对应TC：{loc}")
    A(f"- 对应REQ：{req}")
    A("")

# aggregate structural observations
A("### 问题汇总统计")
A("")
cnt=Counter(i[0] for i in issues)
A("| 级别 | 数量 | 含义 |")
A("|---|---|---|")
A(f"| P0 | {cnt['P0']} | 用例错误（与 Spec 相反或整例不成立） |")
A(f"| P1 | {cnt['P1']} | 用例存疑（Spec 歧义，待确认） |")
A(f"| P2 | {cnt['P2']} | 结构瑕疵（步骤/预期条数、编号格式） |")
A("")
A("- 另有 80 条用例备注含「待确认，需核对产品/后端」，在确认前可执行性受限（多为 Spec 未明确的实现细节）。")
A("- 跨功能点标题重复 1 组：基础设置《新增保存后行内输入区收起》（`基础数据-024` 与 `作业选项-025`），验证对象不同，不判定为重复测试，建议标题加前缀区分。")
A("- 未发现以下问题：无 REQ 对应的用例（1188 条全部可映射 REQ）；空标题/空测试点/空预期；`测试结果` 误填；同 Sheet 编号重复。")
A("")

# ---------- Part 4: coverage ----------
A("## 4. 需求覆盖初步情况（REQ → TC）")
A("")
req2tc={}
for g2,sheet,tcid,reqs,d in catalog:
    for r in reqs:
        req2tc.setdefault(r,[]).append(f"TC-{g2:04d}")
allreq=[f"REQ-{i:03d}" for i in range(1,107)]
A("### 4.1 覆盖总表")
A("")
A("| REQ | 直接关联 TC 数 | TC 列表 |")
A("|---|---|---|")
for r in allreq:
    tcs=req2tc.get(r,[])
    tclist=", ".join(tcs) if tcs else "（无直接用例，见 §4.2）"
    A(f"| {r} | {len(tcs)} | {tclist} |")
A("")
A("### 4.2 无直接用例的 REQ 说明")
A("")
A("| REQ | 名称 | 覆盖判断 |")
A("|---|---|---|")
indirect=[
("REQ-001","系统范围与边界","顶层范围声明，非单一可执行点；其约束被各模块用例分散落实，无需独立用例。"),
("REQ-030","生产阶段自动判定","由质检/列表用例间接覆盖（如 `质检工作台-005`、`产品列表查询-006`、`产品部件操作-012`）。"),
("REQ-037","产品资料存放路径录入","由 `产品详情展示-012` 等覆盖（归在详情展示功能点）。"),
("REQ-049","注文管理番号编号规则","由 `新建订单-026`（年度共用序列）等覆盖。"),
("REQ-055","确认寄出","由 `发货管理-011`、`返送管理-009` 等覆盖（功能点命名为发货管理）。"),
("REQ-056","已寄出后维护与准备删除","由 `发货管理-020/022`、`返送管理-011` 等覆盖。"),
("REQ-094","返送寄送事实与编号","由 `返送补充-027`（RT 编号）等覆盖。"),
("REQ-104","文件版本保留规则","由各文件生成/版本用例覆盖（90+ 条涉版本）。"),
("REQ-105","寄送通知邮件版本化","由 `发货管理-020` 等覆盖。"),
("REQ-106","跨页面编号显示规则","由 `工作台补充-065/069` 等覆盖。"),
]
for r,n,why in indirect:
    A(f"| {r} | {n} | {why} |")
A("")
A("> 结论：106 条 REQ 均有测试承接（直接或间接）；其中 10 条无同前缀直接用例但已被相关功能点覆盖，不构成需求漏测。最终覆盖充分性判定留待 T05 Spec→Test 逐条核对。")
A("")
A("### 4.3 覆盖维度观察")
A("")
A("- 正向流程覆盖充分（902 条，75.9%），主业务状态流转均有用例。")
A("- 边界（3.6%）、权限（2.6%）、错误猜测（1.4%）占比偏低，建议按 AGENTS.md 四类策略补强：字段长度临界、越权访问、并发/级联/缓存风险。")
A("- 各 REQ 关联 TC 数差异大：补充类功能点（如作业补充/返送补充/工作台补充）存在一 TC 映射多 REQ，颗粒度需在 T05 复核是否一点一验。")
A("")

part345="\n".join(L)
final=part12+part345
with open(r"E:\proptest\ai-test\03-testcase\testcase-analysis.md","w",encoding="utf-8") as f:
    f.write(final)
print("issues:",len(issues))
print("final chars:",len(final))
