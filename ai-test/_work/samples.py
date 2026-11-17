# -*- coding: utf-8 -*-
import io, re
out=io.open(r"E:\proptest\ai-test\_work\final_samples.txt","w",encoding="utf-8")
# md blocks
for path,cid in [(r"E:\proptest\case\产品管理模块测试用例.md","产品删除-002"),
                 (r"E:\proptest\case\基础设置模块测试用例.md","基础数据-024"),
                 (r"E:\proptest\case\订单管理模块测试用例.md","发货管理-007")]:
    text=io.open(path,encoding="utf-8").read()
    blocks=re.split(r"(?m)^(?=## )",text)
    for b in blocks:
        m=re.search(r"### 用例编号\s*\n([^\n]+)",b)
        if m and m.group(1).strip()==cid:
            out.write(b+"\n"+"~"*70+"\n"); break
out.close(); print("ok")
