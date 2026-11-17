# -*- coding: utf-8 -*-
import io, re
targets = {
 "FEAT-06-assembly": ["4.5","筛选","范围","首次使用","自动建档"],
 "FEAT-10-order": ["配送地址","联系人","地址","必填","选填"],
 "FEAT-11-shipment": ["加入","报废","未关联","草稿","待确认","校验"],
 "FEAT-12-periodic": ["基准","20日","作废","INVALIDATE","出货"],
 "FEAT-14-reception": ["在制","质检前","正式产品","NG","批次记录","删除"],
 "FEAT-16-work": ["作業中","完了","客户确认","作业状态"],
 "FEAT-17-return": ["批次记录","发行日"],
}
out=io.open(r"E:\proptest\ai-test\_work\targeted_search.txt","w",encoding="utf-8")
base=r"E:\proptest\spec9-29\spec\docs\features"
for feat,kws in targets.items():
    fp=base+"\\"+feat+"\\spec.md"
    lines=io.open(fp,encoding="utf-8").read().splitlines()
    out.write(f"\n{'='*20} {feat} {'='*20}\n")
    for i,l in enumerate(lines,1):
        if any(k in l for k in kws):
            out.write(f"{i}: {l.strip()[:220]}\n")
out.close()
print("ok")
