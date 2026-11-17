import fs from "node:fs";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const rootDir = "E:/proptest";
const outputDir = path.join(rootDir, "case/outputs/测试用例汇总");
const mapping = JSON.parse(fs.readFileSync(path.join(outputDir, "__v4_mapping.json"), "utf8"));
const e2eDefinitions = JSON.parse(fs.readFileSync("e2e_cases.json", "utf8"));
const v5Definitions = JSON.parse(fs.readFileSync("v5_cases.json", "utf8"));
const outputPath = path.join(outputDir, "测试用例汇总_V5.xlsx");
const v3Rows = mapping.rows;
const valItems = mapping.val_items;

const featShortToFull = new Map();
const featFullToShort = new Map();
const featValMap = new Map();
for (const [fullFeat, vals] of Object.entries(valItems)) {
  const shortFeat = fullFeat.match(/^FEAT-\d+/)?.[0] ?? fullFeat;
  featShortToFull.set(shortFeat, fullFeat);
  featFullToShort.set(fullFeat, shortFeat);
  featValMap.set(shortFeat, new Set(vals.map(([val]) => val)));
}

const moduleNames = ["基础设置","客户管理","产品生产","产品管理","订单管理","点检管理","受付工作台","作业管理","首页看板"];
const caseHeaders = ["序号","所属章节","用例标题","用例编号","测试点","优先级","前置条件","测试步骤","预期结果","测试结果","备注","需求编号","FEAT编号","VAL编号","归并状态","归并目标","澄清状态","澄清问题","执行状态","实际结果","缺陷编号","执行人","执行时间"];
const mappingHeaders = ["序号","所属模块","用例编号","用例标题","需求编号","FEAT编号","VAL编号","需求项","执行状态","归并状态","澄清状态","覆盖类型"];
const traceHeaders = ["序号","需求编号","FEAT编号","VAL编号","需求项","关联用例数","通过数","失败数","未执行数","覆盖状态","备注"];
const clarificationHeaders = ["序号","所属模块","用例编号","用例标题","优先级","需求编号","FEAT编号","VAL编号","澄清状态","澄清问题"];
const mergeHeaders = ["序号","所属模块","所属章节","建议动作","涉及用例数","保留主用例","建议合并用例","说明"];

function colLetter(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function shortFeats(row) {
  return row._feats ?? [];
}

function vals(row) {
  return row._vals ?? [];
}

function fullFeats(row) {
  return shortFeats(row).map((feat) => featShortToFull.get(feat) ?? feat);
}

function buildE2eRows() {
  return e2eDefinitions.map((item, index) => ({
    序号: index + 1,
    所属章节: item.section,
    用例标题: item.title,
    用例编号: item.id,
    测试点: item.point,
    优先级: "高",
    前置条件: item.pre,
    测试步骤: item.steps,
    预期结果: item.expect,
    测试结果: "",
    备注: `端到端补充用例：${item.category}`,
    _feats: item.feats.map((value) => `FEAT-${String(value).padStart(2, "0")}`),
    _vals: item.vals,
    _sourceSheet: "端到端补充用例",
  }));
}

function buildV5Rows() {
  return v5Definitions.map((item, index) => ({
    序号: index + 1,
    所属章节: item.section,
    用例标题: item.title,
    用例编号: item.id,
    测试点: item.point,
    优先级: "高",
    前置条件: item.pre,
    测试步骤: item.steps,
    预期结果: item.expect,
    测试结果: "",
    备注: `V5缺口补充用例：${item.category}；依据：${item.source}`,
    _feats: item.feats.map((value) => `FEAT-${String(value).padStart(2, "0")}`),
    _vals: item.vals,
    _sourceSheet: "V5缺口补充用例",
  }));
}

function clarifyState(row) {
  const text = [row["测试点"], row["前置条件"], row["测试步骤"], row["预期结果"], row["备注"]].join("\n");
  const keywords = ["待确认","未明确","需确认","疑问","不确定","无法确认","INVALIDATE"].filter((key) => text.includes(key));
  if (!keywords.length) return { state: "无需澄清", question: "" };
  const resolved = ["已修复","已明确","不再待确认"].some((key) => (row["备注"] ?? "").includes(key));
  if (resolved) return { state: "已澄清", question: "原待确认事项已由备注标记为解决。" };
  return { state: "待澄清", question: `请确认${keywords.join("、")}相关业务规则、状态边界和异常数据处理口径。` };
}

function buildRowsForOutput() {
  const moduleRowsBySheet = new Map(moduleNames.map((name) => [name, []]));
  const groupMap = new Map();
  for (const sourceRow of v3Rows) {
    const targetRows = moduleRowsBySheet.get(sourceRow._sheet);
    if (!targetRows) continue;
    targetRows.push({ ...sourceRow });
    const row = targetRows[targetRows.length - 1];
    const groupKey = `${sourceRow._sheet}|${sourceRow["所属章节"] ?? ""}`;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey).push(row);
  }

  for (const group of groupMap.values()) {
    const supplementRows = group.filter((row) => `${row["所属章节"] ?? ""}${row["用例标题"] ?? ""}`.includes("补充"));
    if (!supplementRows.length) continue;
    const representative = supplementRows[0];
    for (const row of supplementRows) {
      if (row === representative) {
        row["归并状态"] = "保留为主用例";
        row["归并目标"] = "";
      } else {
        row["归并状态"] = "建议合并";
        row["归并目标"] = representative["用例编号"] ?? "";
      }
    }
  }

  const e2eRows = buildE2eRows();
  const v5Rows = buildV5Rows();
  const allRows = [...moduleNames.flatMap((name) => moduleRowsBySheet.get(name)), ...e2eRows, ...v5Rows];
  for (const row of allRows) {
    row["需求编号"] = fullFeats(row).join(";");
    row["FEAT编号"] = shortFeats(row).join(";");
    row["VAL编号"] = vals(row).join(";");
    row["归并状态"] ??= "无需处理";
    row["归并目标"] ??= "";
    const clarify = clarifyState(row);
    row["澄清状态"] = clarify.state;
    row["澄清问题"] = clarify.question;
    row["执行状态"] = "未执行";
    row["实际结果"] = "";
    row["缺陷编号"] = "";
    row["执行人"] = "";
    row["执行时间"] = "";
  }
  return { moduleRowsBySheet, e2eRows, v5Rows, allRows, groupMap };
}

function writeTable(sheet, headers, values) {
  const lastCol = colLetter(headers.length - 1);
  const headerRange = sheet.getRange(`A1:${lastCol}1`);
  headerRange.values = [headers];
  headerRange.format.fill = { type: "solid", color: "#1F4E78" };
  headerRange.format.font = { bold: true, color: "#FFFFFF", size: 11 };
  headerRange.format.horizontalAlignment = "center";
  headerRange.format.verticalAlignment = "center";
  headerRange.format.wrapText = true;
  headerRange.format.rowHeight = 32;
  headerRange.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  if (values.length) {
    const bodyRange = sheet.getRange(`A2:${lastCol}${values.length + 1}`);
    bodyRange.values = values;
    bodyRange.format.wrapText = true;
    bodyRange.format.verticalAlignment = "top";
    bodyRange.format.rowHeight = 34;
    bodyRange.format.borders = { preset: "all", style: "thin", color: "#E7E6E6" };
    for (let row = 2; row <= values.length + 1; row += 2) {
      sheet.getRange(`A${row}:${lastCol}${row}`).format.fill = { type: "solid", color: "#F5F8FC" };
    }
  }
  sheet.freezePanes.freezeRows(1);
  sheet.getRange(`A1:${lastCol}${Math.max(values.length + 1, 2)}`).format.columnWidth = 20;
  sheet.getRange("C:C").format.columnWidth = 34;
  sheet.getRange("D:D").format.columnWidth = 24;
  sheet.getRange("H:I").format.columnWidth = 40;
}

function appendMappingRows(mappingRows, rows, moduleName, coverageType) {
  const mappingSourceRows = appendMappingRows.mappingSourceRows ??= [];
  for (const row of rows) {
    const rowVals = vals(row);
    const feats = shortFeats(row);
    const links = [];
    if (!rowVals.length) {
      for (const feat of feats.length ? feats : [""]) links.push({ feat, val: "" });
    } else {
      for (const val of rowVals) {
        const matchingFeats = feats.filter((feat) => featValMap.get(feat)?.has(val));
        if (matchingFeats.length) {
          for (const feat of matchingFeats) links.push({ feat, val });
        }
      }
    }
    const seen = new Set();
    for (const link of links) {
      const key = `${link.feat}|${link.val}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mappingSourceRows.push(row);
      const valDescription = link.feat ? valItems[featShortToFull.get(link.feat)]?.find(([val]) => val === link.val)?.[1] ?? "" : "";
      mappingRows.push([
        mappingRows.length + 1,
        moduleName,
        row["用例编号"],
        row["用例标题"],
        link.feat ? featShortToFull.get(link.feat) ?? link.feat : "",
        link.feat,
        link.val,
        valDescription,
        row["执行状态"],
        row["归并状态"],
        row["澄清状态"],
        coverageType,
      ]);
    }
  }
}

function getQualityRows(allRows, mappingRows, mergeRows) {
  const v3Only = allRows.filter((row) => row._sourceSheet !== "端到端补充用例" && row._sourceSheet !== "V5缺口补充用例");
  const v5Only = allRows.filter((row) => row._sourceSheet === "V5缺口补充用例");
  const highPriority = v3Only.filter((row) => row["优先级"] === "高").length;
  const supplementRows = v3Only.filter((row) => `${row["所属章节"] ?? ""}${row["用例标题"] ?? ""}`.includes("补充"));
  const clarificationRows = v3Only.filter((row) => row["澄清状态"] === "待澄清");
  const noValRows = v3Only.filter((row) => !vals(row).length);
  const pct = (count) => `${(count * 100 / v3Only.length).toFixed(1)}%`;
  return [
    ["原V3用例总数", `${v3Only.length} 条`, "覆盖 9 个业务模块，V4 完整保留原始用例内容。"],
    ["高优先级用例", `${highPriority} 条（${pct(highPriority)}）`, "可作为第一轮重点执行和回归排序依据。"],
    ["补充类用例", `${supplementRows.length} 条（${pct(supplementRows.length)}）`, "已按模块和章节归并，减少重复维护。"],
    ["待澄清用例", `${clarificationRows.length} 条（${pct(clarificationRows.length)}）`, "已集中到需求澄清清单。"],
    ["无VAL关联用例", `${noValRows.length} 条（${pct(noValRows.length)}）`, "保留在映射表中，便于后续补齐关联。"],
    ["FEAT需求数", `${featShortToFull.size} 个`, "需求编号使用完整 FEAT 文件夹名。"],
    ["VAL验收项", "330 个", "追溯唯一键使用 FEAT编号+VAL编号。"],
    ["端到端补充用例", `${allRows.length - v3Only.length - v5Only.length} 条`, "覆盖失败回滚、并发冲突和数据恢复。"],
    ["V5缺口补充用例", `${v5Only.length} 条`, "补充 V4 追溯矩阵中未覆盖的 VAL 验收项。"],
    ["新增执行管理字段", "5 个", "执行状态、实际结果、缺陷编号、执行人、执行时间。"],
    ["新增追溯和治理字段", "7 个", "需求编号、FEAT编号、VAL编号、归并状态、归并目标、澄清状态、澄清问题。"],
    ["用例-需求映射", `${mappingRows.length} 行`, "一行一条用例与需求的关联关系。"],
    ["需求追溯矩阵", "330 行", "自动统计关联、通过、失败、未执行和覆盖状态。"],
    ["归并重构建议", `${mergeRows.length} 组`, "仅列出存在补充类用例的章节。"],
  ];
}

function buildChangeNotes() {
  return [
    ["版本目标", "以 V3 为基础建立需求追溯、执行跟踪、需求澄清和端到端风险补充。"],
    ["追溯字段", "新增需求编号、FEAT编号、VAL编号；唯一键使用 FEAT编号+VAL编号。"],
    ["执行字段", "新增执行状态、实际结果、缺陷编号、执行人、执行时间；初始状态为未执行。"],
    ["端到端补充", "新增 20 条关键链路用例，覆盖失败回滚、并发冲突和数据恢复。"],
    ["V5缺口补充", "新增 47 条原始 SPEC 缺口用例，补齐 V4 中仍未覆盖的 VAL 验收项。"],
    ["归并治理", "对补充类用例按模块和章节聚合，标注保留主用例和建议合并用例。"],
    ["澄清治理", "集中提取待确认、未明确、需确认等不确定项。"],
    ["测试结果", "保留 V3 测试结果为空，不在用例编写阶段填写 Pass/Fail。"],
  ];
}

function buildMergeRows(groupMap) {
  const result = [];
  for (const [groupKey, rows] of groupMap.entries()) {
    const supplementRows = rows.filter((row) => `${row["所属章节"] ?? ""}${row["用例标题"] ?? ""}`.includes("补充"));
    if (!supplementRows.length) continue;
    const [moduleName, section] = groupKey.split("|");
    const representative = supplementRows[0];
    const mergeIds = supplementRows.filter((row) => row !== representative).map((row) => row["用例编号"]).join(";");
    result.push([
      result.length + 1,
      moduleName,
      section,
      supplementRows.length > 1 ? "归并至主用例" : "保留为主用例",
      supplementRows.length,
      representative["用例编号"] ?? "",
      mergeIds,
      supplementRows.length > 1 ? "同类补充场景合并执行，减少重复维护。" : "仅有一条补充用例，保留为主用例。",
    ]);
  }
  return result;
}

function buildClarificationRows(allRows) {
  return allRows.filter((row) => row["澄清状态"] === "待澄清").map((row) => [
    0,
    row._sourceSheet ?? row._sheet ?? "端到端补充用例",
    row["用例编号"],
    row["用例标题"],
    row["优先级"],
    row["需求编号"],
    row["FEAT编号"],
    row["VAL编号"],
    row["澄清状态"],
    row["澄清问题"],
  ]).map((row, index) => { row[0] = index + 1; return row; });
}

function buildTraceRows() {
  const rows = [];
  for (const [fullFeat, valsList] of Object.entries(valItems)) {
    const shortFeat = featFullToShort.get(fullFeat) ?? fullFeat;
    for (const [val, description] of valsList) {
      rows.push([rows.length + 1, fullFeat, shortFeat, val, description, 0, 0, 0, 0, "", ""]);
    }
  }
  return rows;
}

const workbook = Workbook.create();
const changeSheet = workbook.worksheets.add("说明与变更");
const qualitySheet = workbook.worksheets.add("V3质量分析");
const moduleSheets = new Map(moduleNames.map((name) => [name, workbook.worksheets.add(name)]));
const e2eSheet = workbook.worksheets.add("端到端补充用例");
const v5Sheet = workbook.worksheets.add("V5缺口补充用例");
const mappingSheet = workbook.worksheets.add("用例-需求映射");
const traceSheet = workbook.worksheets.add("需求追溯矩阵");
const clarificationSheet = workbook.worksheets.add("需求澄清清单");
const mergeSheet = workbook.worksheets.add("归并重构建议");

const built = buildRowsForOutput();
const moduleMappingRows = [];
const e2eMappingRows = [];
const v5MappingRows = [];

for (const moduleName of moduleNames) {
  const sheet = moduleSheets.get(moduleName);
  const rows = built.moduleRowsBySheet.get(moduleName);
  const values = rows.map((row) => caseHeaders.map((header) => row[header] ?? ""));
  rows.forEach((row, index) => { row._v4Source = { sheet: moduleName, row: index + 2 }; });
  writeTable(sheet, caseHeaders, values);
  appendMappingRows(moduleMappingRows, rows, moduleName, "原始用例");
}

const e2eValues = built.e2eRows.map((row) => caseHeaders.map((header) => row[header] ?? ""));
built.e2eRows.forEach((row, index) => { row._v4Source = { sheet: "端到端补充用例", row: index + 2 }; });
writeTable(e2eSheet, caseHeaders, e2eValues);
appendMappingRows(e2eMappingRows, built.e2eRows, "端到端补充用例", "端到端补充");

const v5Values = built.v5Rows.map((row) => caseHeaders.map((header) => row[header] ?? ""));
built.v5Rows.forEach((row, index) => { row._v4Source = { sheet: "V5缺口补充用例", row: index + 2 }; });
writeTable(v5Sheet, caseHeaders, v5Values);
appendMappingRows(v5MappingRows, built.v5Rows, "V5缺口补充用例", "V5缺口补充");

const mappingRows = [...moduleMappingRows, ...e2eMappingRows, ...v5MappingRows];
writeTable(mappingSheet, mappingHeaders, mappingRows);
if (mappingRows.length) {
  const statusRange = mappingSheet.getRange(`I2:I${mappingRows.length + 1}`);
  statusRange.formulas = appendMappingRows.mappingSourceRows.map((row) => [`='${row._sheet ?? row._sourceSheet}'!S${row._v4Source.row}`]);
}

for (const sheet of [...moduleSheets.values(), e2eSheet, v5Sheet]) {
  const rowCount = sheet === e2eSheet ? built.e2eRows.length : sheet === v5Sheet ? built.v5Rows.length : built.moduleRowsBySheet.get(sheet.name).length;
  if (!rowCount) continue;
  sheet.getRange(`S2:S${rowCount + 1}`).dataValidation = { rule: { type: "list", values: ["未执行","执行中","通过","失败","阻塞","不适用"] } };
  sheet.getRange(`Q2:Q${rowCount + 1}`).dataValidation = { rule: { type: "list", values: ["无需澄清","待澄清","已澄清"] } };
  sheet.getRange(`O2:O${rowCount + 1}`).dataValidation = { rule: { type: "list", values: ["无需处理","保留为主用例","建议合并"] } };
}

writeTable(qualitySheet, ["指标","结果","说明"], getQualityRows(built.allRows, mappingRows, buildMergeRows(built.groupMap)));
writeTable(changeSheet, ["项目","内容"], buildChangeNotes());
const clarificationRows = buildClarificationRows(built.allRows);
writeTable(clarificationSheet, clarificationHeaders, clarificationRows);
const mergeRows = buildMergeRows(built.groupMap);
writeTable(mergeSheet, mergeHeaders, mergeRows);

const traceRows = buildTraceRows();
writeTable(traceSheet, traceHeaders, traceRows);
if (traceRows.length) {
  const countRange = traceSheet.getRange(`F2:F${traceRows.length + 1}`);
  const passRange = traceSheet.getRange(`G2:G${traceRows.length + 1}`);
  const failRange = traceSheet.getRange(`H2:H${traceRows.length + 1}`);
  const notExecutedRange = traceSheet.getRange(`I2:I${traceRows.length + 1}`);
  const statusRange = traceSheet.getRange(`J2:J${traceRows.length + 1}`);
  countRange.formulas = traceRows.map((_, index) => [`=COUNTIFS('用例-需求映射'!$F$2:$F$${mappingRows.length + 1},C${index + 2},'用例-需求映射'!$G$2:$G$${mappingRows.length + 1},D${index + 2})`]);
  passRange.formulas = traceRows.map((_, index) => [`=COUNTIFS('用例-需求映射'!$F$2:$F$${mappingRows.length + 1},C${index + 2},'用例-需求映射'!$G$2:$G$${mappingRows.length + 1},D${index + 2},'用例-需求映射'!$I$2:$I$${mappingRows.length + 1},"通过")`]);
  failRange.formulas = traceRows.map((_, index) => [`=COUNTIFS('用例-需求映射'!$F$2:$F$${mappingRows.length + 1},C${index + 2},'用例-需求映射'!$G$2:$G$${mappingRows.length + 1},D${index + 2},'用例-需求映射'!$I$2:$I$${mappingRows.length + 1},"失败")`]);
  notExecutedRange.formulas = traceRows.map((_, index) => [`=COUNTIFS('用例-需求映射'!$F$2:$F$${mappingRows.length + 1},C${index + 2},'用例-需求映射'!$G$2:$G$${mappingRows.length + 1},D${index + 2},'用例-需求映射'!$I$2:$I$${mappingRows.length + 1},"未执行")`]);
  statusRange.formulas = traceRows.map((_, index) => [`=IF(F${index + 2}=0,"未覆盖",IF(H${index + 2}>0,"存在失败",IF(G${index + 2}>0,"已通过",IF(I${index + 2}>0,"已覆盖未执行","执行中或阻塞"))))`]);
}

await workbook.recalculate();
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ outputPath, v3Rows: v3Rows.length, e2eRows: built.e2eRows.length, v5Rows: built.v5Rows.length, totalCaseRows: built.allRows.length, mappingRows: mappingRows.length, traceRows: traceRows.length, clarificationRows: clarificationRows.length, mergeGroups: mergeRows.length }, null, 2));
