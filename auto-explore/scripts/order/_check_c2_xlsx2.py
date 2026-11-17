import openpyxl, glob, json, os
p=sorted(glob.glob(r'E:/proptest/auto-explore/reports/order-waybill-C2-*.xlsx'))[-1]
w=openpyxl.load_workbook(p)
print(p)
print(json.dumps([s.title for s in w.worksheets],ensure_ascii=False))
