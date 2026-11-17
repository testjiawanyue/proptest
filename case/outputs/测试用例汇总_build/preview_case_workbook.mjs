import fs from "node:fs/promises";
import { SpreadsheetFile } from "@oai/artifact-tool";

const outputPath = "E:/prov3/docs/outputs/测试用例汇总/测试用例汇总.xlsx";
const previewPath = "E:/prov3/docs/outputs/测试用例汇总_build/首页看板预览.png";

const bytes = await fs.readFile(outputPath);
const workbook = await SpreadsheetFile.importXlsx(bytes);
const preview = await workbook.render({
  sheetName: "首页看板",
  autoCrop: "all",
  scale: 0.65,
  format: "png",
});

await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
console.log(previewPath);
