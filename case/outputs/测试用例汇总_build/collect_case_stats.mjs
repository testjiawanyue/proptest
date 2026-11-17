import fs from "node:fs";
import path from "node:path";

const caseDir = "E:/prov3/docs/case";
const fieldNames = ["用例编号", "测试点", "优先级", "前置条件", "测试步骤", "预期结果", "测试结果", "备注"];

function parseCases(markdown) {
  const lines = markdown.split(/\r?\n/);
  let section = "";
  let currentCase = null;
  let currentField = "";
  const cases = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      if (/^(?:[一二三四五六七八九十百]+[、.．]|\d+[、.．])/.test(heading)) {
        section = heading;
        currentCase = null;
        currentField = "";
      } else {
        currentCase = { section, title: heading, fields: Object.fromEntries(fieldNames.map((name) => [name, []])) };
        cases.push(currentCase);
        currentField = "";
      }
    } else if (line.startsWith("### ")) {
      const fieldName = line.slice(4).trim();
      if (currentCase && fieldNames.includes(fieldName)) {
        currentField = fieldName;
      }
    } else if (currentCase && currentField) {
      currentCase.fields[currentField].push(line);
    }
  }

  return cases.map((item) => {
    const fields = Object.fromEntries(
      Object.entries(item.fields).map(([name, values]) => [
        name,
        values.map((value) => value.trim()).filter(Boolean).join("\n").trim(),
      ])
    );
    return { section: item.section, title: item.title, ...fields };
  });
}

const files = fs.readdirSync(caseDir).filter((name) => name.endsWith("模块测试用例.md"));
const stats = files.map((file) => {
  const rows = parseCases(fs.readFileSync(path.join(caseDir, file), "utf8"));
  const supplemented = rows.filter((row) => row["备注"].includes("补充来源"));
  const errorRows = rows.filter((row) => row["备注"].includes("【用例错误】") || row["用例编号"].endsWith("-错误"));
  return {
    module: file.replace("模块测试用例.md", ""),
    total: rows.length,
    original: rows.length - supplemented.length,
    supplement: supplemented.length,
    errorCount: errorRows.length,
    errorIds: [...new Set(errorRows.map((row) => row["用例编号"]))],
  };
});

console.log(JSON.stringify(stats, null, 2));
