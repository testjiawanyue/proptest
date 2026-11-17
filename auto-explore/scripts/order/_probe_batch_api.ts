import { randomUUID, createHash } from "node:crypto";
import { apiLogin, apiCall, apiBase } from "../production/prod-runtime-utils.js";

const ids = [210, 211, 212];
const token = await apiLogin("admin", "admin123");
const prepared: any = await apiCall(token, "POST", "/prop/shipment/batch-labels/prepare", {
  carrier: "yamato",
  items: ids.map((shipmentId, index) => ({ shipmentId, copies: index + 1 })),
});
console.log("PREPARE", JSON.stringify(prepared));
const items = (prepared.data || []).map((row: any, index: number) => ({
  shipmentId: row.shipmentId,
  revision: row.revision,
  copies: index + 1,
  sourceToken: row.sourceToken,
  overrides: row.defaults,
}));
const command = {
  requestId: `${randomUUID()}.${createHash("sha256").update(JSON.stringify(ids)).digest("hex")}`,
  carrier: "yamato",
  issueDate: "2026-10-29",
  items,
};
const created: any = await apiCall(token, "POST", "/prop/shipment/batch-labels", command);
console.log("CREATE", JSON.stringify(created));
const content = await fetch(`${apiBase}/prop/shipment/batch-labels/content`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(command),
});
console.log("CONTENT", content.status, content.headers.get("content-type"), (await content.arrayBuffer()).byteLength);
