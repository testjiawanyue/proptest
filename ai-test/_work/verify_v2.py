# -*- coding: utf-8 -*-
import openpyxl, io
wb=openpyxl.load_workbook(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_V2.xlsx")
out=io.open(r"E:\proptest\ai-test\_work\v2_verify.txt","w",encoding="utf-8")
total=0; highlighted=0; nonempty_result=0
FILL="FFF2CC"
for ws in wb.worksheets:
    header=[c.value for c in ws[1]]
    idcol=header.index("用例编号")+1
    rcol=header.index("测试结果")+1
    n=0
    for r in range(2,ws.max_row+1):
        v=ws.cell(row=r,column=idcol).value
        if v is None: continue
        total+=1
        rv=ws.cell(row=r,column=rcol).value
        if rv not in (None,""): nonempty_result+=1
        fill=ws.cell(row=r,column=idcol).fill
        if fill.patternType=="solid" and str(fill.fgColor.rgb).endswith(FILL):
            highlighted+=1; n+=1
    out.write(f"{ws.title}: rows={ws.max_row-1} highlighted={n}\n")
out.write(f"\nTOTAL rows={total} highlighted={highlighted} 非空测试结果={nonempty_result}\n")

# spot check some rows
spot=[("基础设置","基础数据-001"),("订单管理","新建订单-018"),("产品管理","产品详情展示-004"),("产品生产","部件组装-009")]
for sheet,cid in spot:
    ws=wb[sheet]
    header=[c.value for c in ws[1]]
    for r in range(2,ws.max_row+1):
        if str(ws.cell(row=r,column=header.index("用例编号")+1).value).strip()==cid:
            out.write(f"\n--- {sheet}/{cid} (row {r}) ---\n")
            for j,h in enumerate(header,1):
                val=ws.cell(row=r,column=j).value
                out.write(f"  {h}: {str(val)[:160]}\n")
            break
out.close(); print("ok")
