import json, re, io, sys
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)

prio=Counter()
# scenario classification by keywords in title/point
def classify(d):
    blob=d.get("用例标题","")+" "+d.get("测试点","")
    if re.search(r"权限|越权|未登录|无权限|角色",blob): return "权限场景"
    if re.search(r"边界|上限|下限|最大|最小|超限|临界|位数|超长|为空时|空集|最多|最少|临界值",blob): return "边界场景"
    if re.search(r"异常|非法|错误|失败|不能|不可|拦截|拒绝|重复|不存在|冲突|不允许|校验|置灰|阻止",blob): return "异常场景"
    if re.search(r"并发|缓存|级联|旧数据|兼容|误匹配|事务|文案|风险|刷新",blob): return "错误猜测"
    return "正常流程"
scen=Counter()
scen_by_sheet={}
for sheet, items in data.items():
    c=Counter()
    for d in items:
        prio[d.get("优先级","")]+=1
        s=classify(d); scen[s]+=1; c[s]+=1
    scen_by_sheet[sheet]=c

print("== 优先级分布 ==")
for k,v in prio.most_common(): print(f"  {k}: {v} ({v/1188*100:.1f}%)")
print("\n== 场景类型分布(基于标题关键词粗分) ==")
for k,v in scen.most_common(): print(f"  {k}: {v} ({v/1188*100:.1f}%)")
print("\n== 各Sheet场景分布 ==")
for sheet,c in scen_by_sheet.items():
    print(f"  {sheet}: 正常{c['正常流程']} 边界{c['边界场景']} 异常{c['异常场景']} 权限{c['权限场景']} 猜测{c['错误猜测']}")

# 待确认 count in notes
pending=0
for sheet,items in data.items():
    for d in items:
        if "待确认" in d.get("备注",""): pending+=1
print("\n备注含【待确认】用例数:",pending)