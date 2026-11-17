import json, re, io, sys
from collections import Counter, defaultdict
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)

# sheet -> prefix -> list of REQ
M = {
 "基础设置": {
   "部件资料": ["REQ-018","REQ-019"],
   "部件资料版本": ["REQ-018"],
   "基础数据": ["REQ-020","REQ-021","REQ-022"],
   "作业选项": ["REQ-023","REQ-024"],
 },
 "客户管理": {
   "客户列表查询": ["REQ-013"],
   "公司维护": ["REQ-009"],
   "支店现场维护": ["REQ-010"],
   "客户编辑": ["REQ-015"],
   "客户删除": ["REQ-010","REQ-011","REQ-012"],
   "客户详情跳转": ["REQ-014"],
   "客户联动跳转": ["REQ-014"],
   "客户更正履历": ["REQ-015"],
   "客户权限": ["REQ-014","REQ-016"],
   "客户主体选择": ["REQ-016"],
   "客户回归": ["REQ-017"],
 },
 "产品生产": {
   "衣体入库": ["REQ-025"],
   "部件组装": ["REQ-026","REQ-027"],
   "质检工作台": ["REQ-028"],
   "产品生产权限": ["REQ-028"],
 },
 "产品管理": {
   "产品列表查询": ["REQ-031"],
   "产品列表数据关联": ["REQ-031"],
   "产品删除": ["REQ-032"],
   "产品详情展示": ["REQ-029","REQ-035","REQ-036"],
   "产品部件操作": ["REQ-033","REQ-034"],
   "部件追溯": ["REQ-038","REQ-039","REQ-040"],
   "产品管理权限": ["REQ-031"],
 },
 "订单管理": {
   "订单列表查询": ["REQ-044"],
   "新建订单": ["REQ-041","REQ-042","REQ-043","REQ-048"],
   "订单详情": ["REQ-045","REQ-050"],
   "订单编辑": ["REQ-048"],
   "订单取消": ["REQ-046"],
   "发货管理": ["REQ-051","REQ-052","REQ-053","REQ-054"],
   "解除产品关联": ["REQ-047"],
   "批量打印面单": ["REQ-103"],
   "订单权限": ["REQ-044"],
   "订打补充": ["REQ-103"],
 },
 "点检管理": {
   "生命周期建立": ["REQ-059"],
   "定期管理": ["REQ-060","REQ-061"],
   "通知建立": ["REQ-057","REQ-058","REQ-062"],
   "通知版本": ["REQ-057"],
   "受付情况查看": ["REQ-063"],
   "通知管理": ["REQ-064","REQ-065"],
   "返送管理": ["REQ-095"],
   "返送补充": ["REQ-096","REQ-097","REQ-098","REQ-099","REQ-100","REQ-101"],
   "返打补充": ["REQ-102"],
 },
 "受付工作台": {
   "大番号建立": ["REQ-066"],
   "包裹登记": ["REQ-067"],
   "产品受付": ["REQ-068"],
   "临时来件受付": ["REQ-069"],
   "正式NG登记": ["REQ-075"],
   "受付作业边界": ["REQ-076"],
   "大番号完成": ["REQ-070"],
   "工作台补充": ["REQ-071","REQ-072","REQ-073","REQ-074"],
   "履歴补充": ["REQ-077","REQ-078","REQ-079"],
   "受付履历查询": ["REQ-077"],
   "批次记录表": ["REQ-078"],
 },
 "作业管理": {
   "作业列表查询": ["REQ-081"],
   "专业作业记录": ["REQ-080"],
   "任务流边界": ["REQ-080"],
   "部件更换拆除": ["REQ-085","REQ-086","REQ-088"],
   "报告生成": ["REQ-089"],
   "报告版本修正": ["REQ-090"],
   "最终处理": ["REQ-091"],
   "作业补充": ["REQ-082","REQ-083","REQ-084","REQ-087","REQ-092","REQ-093"],
 },
 "首页看板": {
   "页面展示": ["REQ-008"],
   "订单一览": ["REQ-002"],
   "待办事项": ["REQ-003"],
   "厂内作业": ["REQ-004"],
   "今日作业": ["REQ-005"],
   "厂内库存": ["REQ-006"],
   "半成品": ["REQ-007"],
   "页面跳转": ["REQ-008"],
 },
}

def prefix_of(tcid):
    return re.sub(r"-\d{3}(-错误)?$","",tcid)

catalog=[]
missing_map=[]
reqcount=Counter()
g=0
for sheet, items in data.items():
    for d in items:
        g+=1
        tcid=d.get("用例编号","")
        pref=prefix_of(tcid) if tcid else ""
        reqs=M.get(sheet,{}).get(pref,[])
        if not reqs:
            missing_map.append((sheet,tcid,pref))
        for r in reqs: reqcount[r]+=1
        catalog.append((g,sheet,tcid,pref,reqs,d))

print("全局TC数:",g)
print("未映射:",missing_map)
allreq=[f"REQ-{i:03d}" for i in range(1,107)]
zero=[r for r in allreq if reqcount[r]==0]
print("零覆盖REQ:",zero)
print("\nREQ覆盖计数:")
for r in allreq:
    print(f"  {r}: {reqcount[r]}")

# save mapping artifact
with open(r"E:\proptest\ai-test\_work\catalog.json","w",encoding="utf-8") as f:
    json.dump([{"tc":f"TC-{a:04d}","sheet":b,"orig":c,"prefix":d,"reqs":e} for a,b,c,d,e,_ in catalog],f,ensure_ascii=False)