# -*- coding: utf-8 -*-
import openpyxl, io
wb=openpyxl.load_workbook(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_V2.xlsx")
out=io.open(r"E:\proptest\ai-test\_work\last_check.txt","w",encoding="utf-8")
for sheet,cid in [("产品生产","质检工作台-009"),("订单管理","订单列表查询-006")]:
    ws=wb[sheet]; header=[c.value for c in ws[1]]
    for r in range(2,ws.max_row+1):
        if str(ws.cell(r,header.index("用例编号")+1).value).strip()==cid:
            note=ws.cell(r,header.index("备注")+1).value
            out.write(f"{sheet}/{cid}:\n{note}\n\n"); break
# audit section of repaired md
t=io.open(r"E:\proptest\ai-test\03-testcase\testcase-analysis-repaired.md",encoding="utf-8").read()
i=t.rfind("## 5.")
out.write(t[i:])
out.close(); print("ok")
