# -*- coding: utf-8 -*-
import openpyxl, io
wb=openpyxl.load_workbook(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_修改标注.xlsx")
out=io.open(r"E:\proptest\ai-test\_work\fills.txt","w",encoding="utf-8")
for ws in wb.worksheets:
    n=0; samples=set()
    for row in ws.iter_rows():
        for c in row:
            f=c.fill
            if f and f.fgColor and f.patternType:
                rgb=f.fgColor.rgb
                if rgb not in ("00000000",) :
                    n+=1; samples.add(f"{f.patternType}:{rgb}")
    out.write(f"{ws.title}: colored cells={n} {sorted(samples)[:6]}\n")
# also check freeze panes / widths
out.write("\nfreeze: "+", ".join(f"{ws.title}={ws.freeze_panes}" for ws in wb.worksheets))
out.close(); print("ok")
