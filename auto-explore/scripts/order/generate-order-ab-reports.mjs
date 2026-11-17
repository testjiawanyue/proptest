import fs from 'node:fs';
const base = 'E:/proptest/auto-explore/reports';
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const read = (f) => JSON.parse(fs.readFileSync(`${base}/${f}`, 'utf8'));
const count = (rows, status) => rows.filter((r) => r.status === status).length;

function render({ title, batch, rows, trace, fixtures, note = '', fix = null }) {
  const body = rows.map((r) => ({
    ...r,
    evidence: fix ? String(r.evidence).replaceAll(fix[0], fix[1]) : r.evidence,
  }));
  const lines = [
    `# 订单管理模块 V5 未执行用例运行时验证（${batch} 批）`,
    '',
    '- 执行日期：2026-10-29',
    '- 环境：前端 http://localhost:8090、后端 http://localhost:8080、MySQL 127.0.0.1:13306/prop_dev_local',
    `- 范围：${title}`,
    '- 方法：Playwright + tsx 真实 UI 操作，叠加 API 直连与 MySQL 断言三路取证',
    `- 结果文件：\`reports/${batch === 'A' ? 'order-runtime-results-A.json' : 'order-runtime-results-B.json'}\``,
    `- Trace：\`${trace}\``,
    '',
    '## 总览',
    '',
    '| 结果 | 条数 |',
    '|---|---:|',
    `| 通过 | ${count(body, '通过')} |`,
    `| 部分验证 | ${count(body, '部分验证')} |`,
    `| 不通过 | ${count(body, '不通过')} |`,
    `| **合计** | **${body.length}** |`,
    '',
    '## 逐用例结果',
    '',
    '| 用例编号 | 用例标题 | 结论 | 运行时实际 | 取证方式 | 需求依据 |',
    '|---|---|---|---|---|---|',
    ...body.map((r) => `| ${esc(r.caseId)} | ${esc(r.title)} | **${esc(r.status)}** | ${esc(r.actual)} | ${esc(r.evidence)} | ${esc(r.requirement)} |`),
    '',
  ];
  if (note) lines.push('## 说明', '', note, '');
  lines.push('## 遗留测试数据', '', ...fixtures.map((x) => `- ${x}`), '');
  lines.push('## 回写与清理状态', '', '- 本批结果尚未回写 V5 Excel，待全部订单批次完成后统一执行。', '- 测试夹具尚未清理，需在全部批次结束后统一清理。', '');
  return lines.join('\n');
}

const a = read('order-runtime-results-A.json');
const b = read('order-runtime-results-B.json');
fs.writeFileSync(`${base}/verify-order-A.md`, render({
  title: '订单列表、新建订单、订单详情与订单权限共 12 条',
  batch: 'A', rows: a,
  trace: 'reports/traces/verify-order-A.zip；订单列表专项 reports/traces/verify-order-A-015.zip',
  fixtures: [
    '客户 A：subject_id=76（AUTO-ORD-A 订单会社），住所约 address_id=51，联系人 contact_id=54。',
    '客户 B：subject_id=77（AUTO-ORD-B 代理会社）。',
    '订单：18、19、20；重跑订单 21、22、23。',
    '新增地址：address_id=54（新建订单-007）。'
  ],
  fix: ['UI /orders ', 'UI /orders/index '],
}), 'utf8');
fs.writeFileSync(`${base}/verify-order-B.md`, render({
  title: '订单编辑、解除产品关联、订单取消与并发权限共 8 条',
  batch: 'B', rows: b,
  trace: 'reports/traces/verify-order-B.zip',
  note: [
    '- **订单权限-005 为部分验证，不是已确认缺陷。** 后端在第二笔准备的“加入产品”阶段即通过 `prop_shipment_reservation` 拒绝同产品占用，因此无法构造“两笔准备均已加入同一产品后并发确认”的前置条件。',
    '- 该用例的安全目标已验证成立：并发确认后产品最终只有 1 条有效订单关系、占用记录为 0，未产生重复履约。',
    '- 如需严格覆盖用例原前置，应在允许共享准备占用或可注入并发窗口的专用环境中补测。'
  ].join('\n'),
  fixtures: [
    '订单：edit3=33、edit5=34、cancel=35、reuse=36、reshipClear=37、reshipKeep=38、perm=39/40。',
    '产品：AUTO-ORD-B-20261029100220-P01~P09 = 48~56。',
    '首次运行失败数据保留：订单 25~32、产品 39~47。',
    '早期探测数据：订单 24；产品 36（已寄出）、37（准备中）；寄送 30、32；文件 file_id=11。'
  ],
}), 'utf8');
console.log('generated A/B reports');