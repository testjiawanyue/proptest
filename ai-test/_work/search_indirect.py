import json, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)
def search(kw):
    hits=[]
    for sheet, items in data.items():
        for d in items:
            blob=" ".join([d.get("用例标题",""),d.get("测试点",""),d.get("预期结果",""),d.get("备注","")])
            if kw in blob:
                hits.append((sheet,d.get("用例编号",""),d.get("用例标题","")[:30]))
    return hits
for kw,label in [("存放路径","REQ-037 存放路径"),("生产阶段","REQ-030 生产阶段"),
                 ("注文管理番号","REQ-049 编号规则"),("确认寄出","REQ-055/056 寄出及维护"),
                 ("返送编号","REQ-094 返送事实"),("版本","REQ-104/105 文件版本"),
                 ("受付番号","REQ-106 编号显示")]:
    hits=search(kw)
    print(f"== {label}: {len(hits)}条 ==")
    for h in hits[:10]:
        print("   ",h)