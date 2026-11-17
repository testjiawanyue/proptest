import json, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)
want = {("产品生产","衣体入库-012"),("产品生产","部件组装-001-错误"),("产品生产","部件组装-009-错误"),
        ("产品生产","部件组装-010-错误"),("基础设置","作业选项-016-错误"),("订单管理","新建订单-011"),
        ("产品生产","衣体入库-001"),("产品生产","衣体入库-005")}
for sheet, items in data.items():
    for d in items:
        key=(sheet,d.get("用例编号",""))
        if key in want:
            print("="*70)
            print(key)
            print("标题:",d.get("用例标题",""))
            print("测试点:",d.get("测试点",""))
            print("前置:",d.get("前置条件",""))
            print("步骤:",d.get("测试步骤",""))
            print("预期:",d.get("预期结果",""))
            print("备注:",d.get("备注",""))