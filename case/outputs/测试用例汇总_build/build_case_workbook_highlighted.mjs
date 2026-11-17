import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourceDir = "E:/prov3/docs/case";
const outputPath = "E:/prov3/docs/outputs/测试用例汇总/测试用例汇总_修改标注.xlsx";

const modifiedById = {
  "产品管理": ["产品删除-001","产品删除-004","产品删除-008","部件追溯-010","部件追溯-013","产品管理权限-005","产品部件操作-005","产品部件操作-013"],
  "产品生产": ["衣体入库-024","衣体入库-025","衣体入库-026","衣体入库-027"],
  "点检管理": ["返送管理-011","返送补充-098"],
  "订单管理": ["发货管理-014","发货管理-019"],
  "基础设置": ["部件资料-007","部件资料-013","部件资料-014","部件资料-026","部件资料-027","部件资料-028","部件资料版本-003","部件资料版本-008","基础数据-026","基础数据-027","基础数据-028","基础数据-029","作业选项-027","作业选项-028","作业选项-029","作业选项-030"],
  "客户管理": ["客户列表查询-007","客户列表查询-029","客户列表查询-030","客户列表查询-031","客户列表查询-032"],
  "首页看板": [],
  "受付工作台": [],
  "作业管理": ["作业补充-049","作业补充-051"]
};

const modules = [
  { file: "产品管理模块测试用例.md", sheet: "产品管理" },
  { file: "产品生产模块测试用例.md", sheet: "产品生产" },
  { file: "点检管理模块测试用例.md", sheet: "点检管理" },
  { file: "订单管理模块测试用例.md", sheet: "订单管理" },
  { file: "基础设置模块测试用例.md", sheet: "基础设置" },
  { file: "客户管理模块测试用例.md", sheet: "客户管理" },
  { file: "首页看板模块测试用例.md", sheet: "首页看板" },
  { file: "受付工作台模块测试用例.md", sheet: "受付工作台" },
  { file: "作业管理模块测试用例.md", sheet: "作业管理" }
];

const headers = [
  "序号","所属章节","用例标题","用例编号","测试点","优先级","前置条件","测试步骤","预期结果","测试结果","备注"
];

const fieldNames = [
  "用例编号","测试点","优先级","前置条件","测试步骤","预期结果","测试结果","备注"
];

function normalizeContent(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function parseCases(markdown, moduleName) {
  const lines = markdown.split(/\r?\n/);
  const cases = [];
  let section = "";
  let currentCase = null;
  let currentField = null;

  function startCase(title) {
    currentCase = {
      section,
      title,
      fields: Object.fromEntries(fieldNames.map((name) => [name, []]))
    };
    cases.push(currentCase);
    currentField = null;
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      if (/^(?:[一二三四五六七八九十百]+[、.．]|\d+[、.．])/.test(heading)) {
        section = heading;
        currentCase = null;
      } else {
        startCase(heading);
      }
      continue;
    }

    if (line.startsWith("### ")) {
      const fieldName = line.slice(4).trim();
      if (currentCase && fieldNames.includes(fieldName)) {
        currentField = fieldName;
      }
      continue;
    }

    if (currentCase && currentField) {
      currentCase.fields[currentField].push(line);
    }
  }

  const warnings = [];
  const seenIds = new Map();

  const rows = cases.map((item, index) => {
    const fields = Object.fromEntries(
      fieldNames.map((name) => [name, normalizeContent(item.fields[name])])
    );

    for (const name of fieldNames) {
      if (name !== "测试结果" && !fields[name]) {
        warnings.push(moduleName + " 第" + (index + 1) + "条用例缺少字段：" + name);
      }
    }

    if (fields["测试结果"]) {
      warnings.push(moduleName + " " + fields["用例编号"] + " 的测试结果非空");
    }

    if (fields["用例编号"]) {
      const count = seenIds.get(fields["用例编号"]) ?? 0;
      seenIds.set(fields["用例编号"], count + 1);
    }

    return [
      index + 1,
      item.section,
      item.title,
      fields["用例编号"],
      fields["测试点"],
      fields["优先级"],
      fields["前置条件"],
      fields["测试步骤"],
      fields["预期结果"],
      "",
      fields["备注"]
    ];
  });

  for (const [caseId, count] of seenIds) {
    if (count > 1) {
      warnings.push(moduleName + " 用例编号重复：" + caseId + "，出现" + count + "次");
    }
  }

  return { rows, warnings };
}

function sanitizeSheetName(name) {
  return name.replace(/[\\/?*[\]]/g, "").slice(0, 31);
}

async function main() {
  const workbook = Workbook.create();
  const summary = [];
  const warnings = [];

  for (const module of modules) {
    const filePath = path.join(sourceDir, module.file);
    const markdown = await fs.readFile(filePath, "utf8");
    const { rows, warnings: moduleWarnings } = parseCases(markdown, module.sheet);
    warnings.push(...moduleWarnings);

    const modifiedSet = new Set(modifiedById[module.sheet] ?? []);
    const modifiedRowIndexes = [];
    rows.forEach((row, index) => {
      if (modifiedSet.has(row[3])) modifiedRowIndexes.push(index);
    });

    const sheetName = sanitizeSheetName(module.sheet);
    const sheet = workbook.worksheets.add(sheetName);
    sheet.getRange("A1:K1").values = [headers];

    if (rows.length > 0) {
      sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
    }

    const tableRange = "A1:K" + (rows.length + 1);
    const table = sheet.tables.add(tableRange, true, "Table_" + sheetName);
    table.showFilterButton = true;

    sheet.freezePanes.freezeRows(1);

    const headerRange = sheet.getRange("A1:K1");
    headerRange.format.fill = "#1F4E78";
    headerRange.format.font = { color: "#FFFFFF", bold: true, name: "Microsoft YaHei", size: 11 };
    headerRange.format.horizontalAlignment = "Center";
    headerRange.format.verticalAlignment = "Center";
    headerRange.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };

    const dataRange = sheet.getRangeByIndexes(1, 0, rows.length, headers.length);
    dataRange.format.wrapText = true;
    dataRange.format.verticalAlignment = "Top";
    dataRange.format.horizontalAlignment = "Left";
    dataRange.format.font = { name: "Microsoft YaHei", size: 10 };
    dataRange.format.borders = { preset: "all", style: "thin", color: "#D9D9D9" };

    for (const dataIndex of modifiedRowIndexes) {
      const rowRange = sheet.getRangeByIndexes(dataIndex + 1, 0, 1, headers.length);
      rowRange.format.fill = "#BFBFBF";
    }

    for (const column of ["A", "F", "J"]) {
      sheet.getRange(column + "2:" + column + (rows.length + 1)).format.horizontalAlignment = "Center";
    }

    const widths = [6, 20, 30, 22, 34, 8, 38, 48, 52, 12, 32];
    widths.forEach((width, index) => {
      sheet.getCell(0, index).format.columnWidth = width;
    });

    sheet.getRange("A2:K" + (rows.length + 1)).format.autofitRows();
    summary.push({ sheet: sheetName, count: rows.length, highlighted: modifiedRowIndexes.length });
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputPath);

  console.log(JSON.stringify({ outputPath, total: summary.reduce((sum, item) => sum + item.count, 0), highlighted: summary.reduce((sum, item) => sum + item.highlighted, 0), summary, warnings }, null, 2));

  if (warnings.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
