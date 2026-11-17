import openpyxl, json, glob, os
p=sorted(glob.glob(r'E:/proptest/auto-explore/reports/order-waybill-C2-*.xlsx'))[-1]
wb=openpyxl.load_workbook(p, data_only=False)
out=[]
for ws in wb.worksheets:
    out.append({'title':ws.title,'max_row':ws.max_row,'max_col':ws.max_column,'copies':ws.page_setup.copies,'orientation':ws.page_setup.orientation,'print_area':str(ws.print_area),'fitToWidth':ws.page_setup.fitToWidth,'fitToHeight':ws.page_setup.fitToHeight})
print(json.dumps({'path':p,'sheets':out},ensure_ascii=False,indent=2))
for ws in wb.worksheets:
    vals=[]
    for row in ws.iter_rows():
        for c in row:
            if c.value not in (None,''): vals.append(str(c.value))
    print(ws.title, ' | '.join(vals[:80]))
