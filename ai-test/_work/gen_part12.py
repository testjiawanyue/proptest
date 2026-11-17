import json, re
from collections import Counter

with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)

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

def classify(d):
    blob=d.get("用例标题","")+" "+d.get("测试点","")
    if re.search(r"权限|越权|未登录|无权限|角色",blob): return "权限场景"
    if re.search(r"边界|上限|下限|最大|最小|超限|临界|位数|超长|空集|最多|最少",blob): return "边界场景"
    if re.search(r"异常|非法|错误|失败|不能|不可|拦截|拒绝|重复|不存在|冲突|不允许|校验|置灰|阻止",blob): return "异常场景"
    if re.search(r"并发|缓存|级联|旧数据|兼容|误匹配|事务|文案|风险|刷新",blob): return "错误猜测"
    return "正常流程"

catalog=[]
g=0
for sheet, items in data.items():
    for d in items:
        g+=1
        tcid=d.get("用例编号","")
        pref=prefix_of(tcid) if tcid else ""
        reqs=M.get(sheet,{}).get(pref,[])
        catalog.append((g,sheet,tcid,pref,reqs,d))

def render(g2,sheet,tcid,reqs,d):
    o=[]; a=o.append
    a(f"#### {g2} ｜ {sheet} ｜ TC-{g2:04d}")
    a("")
    reqstr = ", ".join(reqs) if reqs else "（未映射）"
    a(f"REQ：{reqstr}")
    a(f"原始编号：{tcid}")
    a(f"测试目标：{d.get('测试点','')}")
    a(f"优先级：{d.get('优先级','')}　场景类型：{classify(d)}")
    a(f"前置条件：{d.get('前置条件','')}")
    steps=d.get("测试步骤","")
    first=steps.splitlines()[0] if steps else ""
    a(f"输入（测试数据）：{first}")
    a("步骤：")
    a("")
    a("```")
    a(steps)
    a("```")
    a("")
    a("预期：")
    a("")
    a("```")
    a(d.get("预期结果",""))
    a("```")
    a("")
    qc=[]
    if not d.get("前置条件",""): qc.append("前置条件缺失")
    sn=len(re.findall(r"(?m)^\s*\d+[\.、]",steps))
    en=len(re.findall(r"(?m)^\s*\d+[\.、]",d.get("预期结果","")))
    if sn and en and sn!=en: qc.append(f"步骤数{sn}!={en}预期条数")
    note=d.get("备注","")
    if "待确认" in note: qc.append("含待确认项，可执行性受限")
    a("质量检查：" + ("；".join(qc) if qc else "结构完整、预期可验证，未发现字段级缺陷。"))
    if note: a(f"备注：{note}")
    a("")
    return o

L=[]; A=L.append
A("# Test Case Analysis")
A("")
A("> 分析对象：`E:\\proptest\\case\\outputs\\测试用例汇总\\测试用例汇总_修改标注.xlsx`（最终审核标注版，9 个 Sheet）。")
A("> 参照原稿：`测试用例汇总.xlsx`；用例设计源：`E:\\proptest\\case` 下各模块测试用例 Markdown。")
A("> 依据：Spec（需求基线）+ 测试用例；本任务不依据代码判断用例正确性。用例与 Spec 不一致处均显式标记。")
A("")
A("## 1. 测试用例概览")
A("")
A("### 1.1 总量与分布")
A("")
prio=Counter(d.get("优先级","") for *x,d in [(0,0,0,0,0,{})] ) if False else Counter(d.get("优先级","") for *_,d in [(0,0,0,0,0,{})])
prio=Counter(d.get("优先级","") for *_,d in [(0,0,0,0,0,{})])
prio=Counter(d.get("优先级","") for tup in catalog for d in [tup[5]])
scen=Counter(classify(tup[5]) for tup in catalog)
A("| 指标 | 数值 |")
A("|---|---|")
A("| 用例总数 | 1188 |")
A("| 来源 Sheet | 9 个（基础设置/客户管理/产品生产/产品管理/订单管理/点检管理/受付工作台/作业管理/首页看板） |")
A(f"| 优先级 高 | {prio['高']}（{prio['高']/1188*100:.1f}%） |")
A(f"| 优先级 中 | {prio['中']}（{prio['中']/1188*100:.1f}%） |")
A(f"| 优先级 低 | {prio['低']}（{prio['低']/1188*100:.1f}%） |")
A(f"| 正常流程 | {scen['正常流程']}（{scen['正常流程']/1188*100:.1f}%） |")
A(f"| 异常场景 | {scen['异常场景']}（{scen['异常场景']/1188*100:.1f}%） |")
A(f"| 边界场景 | {scen['边界场景']}（{scen['边界场景']/1188*100:.1f}%） |")
A(f"| 权限场景 | {scen['权限场景']}（{scen['权限场景']/1188*100:.1f}%） |")
A(f"| 错误猜测 | {scen['错误猜测']}（{scen['错误猜测']/1188*100:.1f}%） |")
A("")
A("### 1.2 各 Sheet 用例数与场景分布")
A("")
A("| Sheet | 用例数 | 正常 | 边界 | 异常 | 权限 | 错误猜测 |")
A("|---|---|---|---|---|---|---|")
for sheet, items in data.items():
    c=Counter(classify(d) for d in items)
    A(f"| {sheet} | {len(items)} | {c['正常流程']} | {c['边界场景']} | {c['异常场景']} | {c['权限场景']} | {c['错误猜测']} |")
A("")
A("### 1.3 Test Case Model（11 字段）")
A("")
A("每条用例按以下 11 个分析项建模；原始表格字段与之一一对应：")
A("")
A("| # | 分析项 | 表格来源字段 | 说明 |")
A("|---|---|---|---|")
model_rows=[("TC-ID","用例编号","全局分析另配 TC-NNNN（TC-0001～TC-1188 按 Sheet 顺序连续）；原始形态 <功能点>-<NNN>"),
("对应REQ-ID","（映射）","按功能点前缀映射到需求基线 REQ，见 §4/§5"),
("测试目的","测试点","单一验证目标"),
("前置条件","前置条件","角色、存量数据、业务状态"),
("测试数据","前置条件/测试步骤","执行所需编号、数量、配置"),
("操作步骤","测试步骤","编号步骤，逐步对应预期"),
("预期结果","预期结果","编号、可独立验证"),
("异常场景","（派生）","非法输入/拦截/冲突"),
("边界场景","（派生）","临界值/位数/上下限"),
("权限场景","（派生）","越权/角色限制/未登录"),
("数据验证","预期结果/备注","对数据库或页面数据变化的断言")]
for i,(a1,b1,c1) in enumerate(model_rows,1):
    A(f"| {i} | {a1} | {b1} | {c1} |")
A("")
A("### 1.4 总体质量结论（摘要）")
A("")
A("- 字段完整性良好：1188 条用例标题/编号/测试点/前置/步骤/预期均非空，`测试结果` 全部留空，符合设计阶段纪律。")
A("- 已完成一轮审核标注：【用例错误】25 条、【用例存疑】6 条、【已修正】38 条、【已补充】5 条。")
A("- 主要风险：25 条用例预期与 Spec 相反或整例不成立；80 条含「待确认」影响可执行性；边界/权限/错误猜测三类合计约 7.6%，覆盖偏弱。")
A("- 结构瑕疵：24 条步骤数与预期条数不对应；13 条以 `-错误` 后缀偏离编号约定；1 组标题跨功能点重复。")
A("")
A("## 2. TC 用例模型明细")
A("")
A("> 1188 条完整台账见 §2.3；本节展开各 Sheet 代表用例（§2.1）与全部 31 条重点标注用例（§2.2）。")
A("")
A("### 2.1 各 Sheet 代表用例")
A("")
seen=set()
for g2,sheet,tcid,pref,reqs,d in catalog:
    if sheet not in seen:
        seen.add(sheet)
        L.extend(render(g2,sheet,tcid,reqs,d))
A("### 2.2 重点标注用例（31 条：用例错误 25 + 用例存疑 6）")
A("")
for g2,sheet,tcid,pref,reqs,d in catalog:
    if re.findall(r"【(用例错误|用例存疑)】",d.get("备注","")):
        L.extend(render(g2,sheet,tcid,reqs,d))
A("### 2.3 全量用例台账（TC-0001～TC-1188）")
A("")
A("> 完整步骤/预期以 xlsx 为准；本表给出全局 TC-ID、Sheet、原始编号、REQ、场景、优先级与标题。")
A("")
cur=None
for g2,sheet,tcid,pref,reqs,d in catalog:
    if sheet!=cur:
        cur=sheet
        A(f"**{sheet}**")
        A("")
        A("| TC-ID | 原始编号 | REQ | 场景 | 优先级 | 用例标题 |")
        A("|---|---|---|---|---|---|")
    title=d.get("用例标题","").replace("|","／")
    A(f"| TC-{g2:04d} | {tcid} | {','.join(reqs)} | {classify(d)} | {d.get('优先级','')} | {title} |")
A("")

with open(r"E:\proptest\ai-test\_work\part12.md","w",encoding="utf-8") as f:
    f.write("\n".join(L))
print("part12 chars:", len("\n".join(L)))
