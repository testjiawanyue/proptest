# -*- coding: utf-8 -*-
import io, os, re
out=io.open(r"E:\proptest\ai-test\_work\reception_rules.txt","w",encoding="utf-8")
files=[r"E:\proptest\spec9-29\spec\docs\features\FEAT-14-reception\spec.md",
       r"E:\proptest\spec9-29\spec\docs\baseline\identity-history-rules.md",
       r"E:\proptest\spec9-29\spec\docs\baseline\business-flow.md"]
kws=["在制","正式产品","质检","识别","扫描","受付对象","作废","INVALIDATE","基准","出货","产品成立"]
for fp in files:
    out.write(f"\n{'='*20} {os.path.basename(fp)} {'='*20}\n")
    for i,l in enumerate(io.open(fp,encoding="utf-8").read().splitlines(),1):
        if any(k in l for k in kws):
            out.write(f"{i}: {l.strip()[:230]}\n")
out.close(); print("ok")
