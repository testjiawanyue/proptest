import fs from "node:fs/promises";
import { SpreadsheetFile } from "@oai/artifact-tool";

const outputPath = "E:/prov3/docs/outputs/测试用例汇总/测试用例汇总.xlsx";
const expectedHeaders = [
  "序号",
  "所属章节",
  "用例标题",
  "用例编号",
  "测试点",
  "优先级",
  "前置条件",
  "测试步骤",
  "预期结果",
  "测试结果",
  "备注",
];
const expected = [
  ["产品管理", 71],
  ["产品生产", 87],
  ["点检管理", 287],
  ["订单管理", 139],
  ["基础设置", 98],
  ["客户管理", 111],
  ["首页看板", 55],
  ["受付工作台", 186],
  ["作业管理", 153],
];

const bytes = await fs.readFile(outputPath);
const workbook = await SpreadsheetFile.importXlsx(bytes);
const sheets = workbook.worksheets.items;
const errors = [];
const actual = [];

if (sheets.length !== 9) {
  errors.push(`Sheet 数量应为 9，实际为 ${sheets.length}`);
}

for (const [sheetName, expectedCount] of expected) {
  const sheet = sheets.find((item) => item.name === sheetName);
  if (!sheet) {
    errors.push(`缺少 Sheet：${sheetName}`);
    continue;
  }

  const values = sheet.getUsedRange(true).values;
  const headers = values[0];
  const rows = values.slice(1);
  actual.push([sheetName, rows.length]);

  if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
    errors.push(`${sheetName} 表头不匹配：${JSON.stringify(headers)}`);
  }

  if (rows.length !== expectedCount) {
    errors.push(`${sheetName} 用例数应为 ${expectedCount}，实际为 ${rows.length}`);
  }

  rows.forEach((row, index) => {
    if (row[9] !== "" && row[9] !== null && row[9] !== undefined) {
      errors.push(`${sheetName} 第${index + 2}行测试结果非空`);
    }
    if (!row[3] || !row[7] || !row[8]) {
      errors.push(`${sheetName} 第${index + 2}行编号、步骤或预期结果缺失`);
    }
  });
}

const result = {
  outputPath,
  sheetCount: sheets.length,
  total: actual.reduce((sum, [, count]) => sum + count, 0),
  sheets: actual.map(([name, count]) => ({ sheet: name, count })),
  errors,
};

console.log(JSON.stringify(result, null, 2));

if (errors.length > 0) {
  process.exit(1);
}
