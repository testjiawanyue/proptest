import json, re, io, sys, os
from collections import Counter, defaultdict
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)

FIELDS = ["用例标题","用例编号","测试点","优先级","前置条件","测试步骤","预期结果","测试结果","备注"]
issues = []
allids = []
titles = defaultdict(list)
annotation_counter = Counter()
annotation_examples = defaultdict(list)

tc_global = 0
for sheet, items in data.items():
    sheet_local_ids = set()
    for idx, d in enumerate(items, 1):
        tc_global += 1
        tcid = d.get("用例编号","")
        title = d.get("用例标题","")
        point = d.get("测试点","")
        prio = d.get("优先级","")
        pre = d.get("前置条件","")
        steps = d.get("测试步骤","")
        expected = d.get("预期结果","")
        result = d.get("测试结果","")
        note = d.get("备注","")
        loc = f"{sheet}/{tcid or ('row'+str(idx))}"
        allids.append((tcid, loc))

        if not tcid: issues.append((loc,"REQ无TC编号(空用例编号)"))
        if not title: issues.append((loc,"用例标题为空"))
        if not point: issues.append((loc,"测试点为空(目的不明确)"))
        if prio not in ("高","中","低"): issues.append((loc,f"优先级异常:{prio or '空'}"))
        if not pre: issues.append((loc,"前置条件为空"))
        if not steps: issues.append((loc,"测试步骤为空"))
        if not expected: issues.append((loc,"预期结果为空(不可验证)"))
        if result.strip(): issues.append((loc,f"测试结果字段被填写(设计阶段应留空):{result[:20]}"))

        # ID format: <功能点>-<3 digits>
        m = re.match(r"^(.+?)-(\d{3})$", tcid)
        if tcid and not m:
            issues.append((loc,f"编号格式不符约定:{tcid}"))
        if tcid:
            if tcid in sheet_local_ids:
                issues.append((loc,f"同Sheet内编号重复:{tcid}"))
            sheet_local_ids.add(tcid)

        # duplicate title within sheet
        titles[(sheet,title)].append(tcid)

        # steps vs expected numbering counts
        sn = len(re.findall(r"(?m)^\s*\d+[\.、]", steps)) if steps else 0
        en = len(re.findall(r"(?m)^\s*\d+[\.、]", expected)) if expected else 0
        if steps and expected and sn and en and sn != en:
            issues.append((loc,f"步骤数({sn})与预期条数({en})不一致"))

        # expected contains step text embedded? rough: expected lines that start with non-number
        # annotations in note
        for tag in re.findall(r"【[^】]+】", note):
            annotation_counter[tag] += 1
            if len(annotation_examples[tag]) < 8:
                annotation_examples[tag].append(loc)
        if note and not re.findall(r"【[^】]+】", note):
            pass

# duplicate titles
for (sheet,title), ids in titles.items():
    if title and len(ids) > 1:
        issues.append((f"{sheet}", f"标题重复{len(ids)}次:《{title[:30]}》 ids={ids}"))

# cross-sheet duplicate IDs
idmap = defaultdict(list)
for tcid, loc in allids:
    if tcid: idmap[tcid].append(loc)
for tcid, locs in idmap.items():
    sheets = {l.split("/")[0] for l in locs}
    if len(locs) > 1:
        # same prefix reused across sheets is expected (功能点-序号 resets); only flag same sheet handled above
        pass

out = []
out.append(f"总用例数: {tc_global}")
out.append(f"问题条目总数: {len(issues)}")
out.append("\n== 备注标注统计 ==")
for tag,c in annotation_counter.most_common():
    out.append(f"{tag} x{c}  例:{annotation_examples[tag][:5]}")
out.append("\n== 问题分类计数 ==")
cat = Counter()
for loc,msg in issues:
    if "空用例编号" in msg: cat["无TC编号"]+=1
    elif "用例标题为空" in msg: cat["标题空"]+=1
    elif "测试点为空" in msg: cat["测试点空"]+=1
    elif "优先级异常" in msg: cat["优先级异常"]+=1
    elif "前置条件为空" in msg: cat["前置条件空"]+=1
    elif "测试步骤为空" in msg: cat["步骤空"]+=1
    elif "预期结果为空" in msg: cat["预期空"]+=1
    elif "测试结果字段被填写" in msg: cat["结果误填"]+=1
    elif "编号格式" in msg: cat["编号格式"]+=1
    elif "编号重复" in msg: cat["编号重复"]+=1
    elif "标题重复" in msg: cat["标题重复"]+=1
    elif "步骤数" in msg: cat["步骤预期条数不符"]+=1
    else: cat["其他"]+=1
for k,v in cat.most_common():
    out.append(f"{k}: {v}")
out.append("\n== 问题明细(前120条) ==")
for loc,msg in issues[:120]:
    out.append(f"[{loc}] {msg}")

rep = "\n".join(out)
with open(r"E:\proptest\ai-test\_work\check_report.txt","w",encoding="utf-8") as f:
    f.write(rep)
print(rep[:6000])