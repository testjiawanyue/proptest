#!/usr/bin/env node
/**
 * check-module.mjs —— 模块门禁自检
 *
 * 用法：
 *   node tools/check-module.mjs modules/FEAT-02-part-profile            # 全部三道门
 *   node tools/check-module.mjs modules/FEAT-02-part-profile --gate=M1  # 只查文档门
 *   node tools/check-module.mjs modules/ --all                          # 扫描全部模块
 *   node tools/check-module.mjs modules/xxx --json                       # 机读输出
 *
 * 设计原则：
 *   1. 只认"文档里的实测记录"，不认口头确认 —— 所有关键字段必须能在 md 里找到证据。
 *   2. 区分 FAIL（阻断）/ WARN（需人工确认）/ PASS。
 *   3. 退出码：有 FAIL → 1，否则 0。便于后续接 CI（基线快照比对时直接复用）。
 *
 * 版本：v1.1（对应 templates v1.1）
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------- CLI ----------------
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positionals = argv.filter((a) => !a.startsWith('--'));
const wantJson = flags.includes('--json');
const scanAll = flags.includes('--all');
const gate = (flags.find((f) => f.startsWith('--gate=')) || '--gate=ALL').split('=')[1].toUpperCase();

if (!positionals.length) {
  console.error('用法: node tools/check-module.mjs <模块目录|modules根目录> [--gate=M1|M2|M3|ALL] [--all] [--json]');
  process.exit(2);
}

const FILES = {
  card: '00-模块卡.md',
  vp: '01-验收点清单.md',
  map: '02-用例与自动化归属.md',
  rec: '03-验证记录.md',
  exit: '04-准出卡.md',
};

// ---------------- 工具 ----------------
const PLACEHOLDER_RE = /^(?:|[_—–-]{2,}|…+|\.{3,}|TBD|N\/A|待填|待补|待定|示例.*)$/i;

function isBlank(cell) {
  if (cell === undefined || cell === null) return true;
  const s = String(cell).replace(/\*\*/g, '').replace(/`/g, '').trim();
  if (PLACEHOLDER_RE.test(s)) return true;
  return false;
}

/** 把 md 切成 §section，并解析每个 section 里的表格 */
function parseDoc(text) {
  const sections = [];
  const blocks = text.split(/\n(?=#{2,4}\s)/);
  for (const b of blocks) {
    const hm = b.match(/^(#{2,4})\s+(.*)$/m) || [, '', ''];
    const level = hm[1].length;
    const h = hm[2].trim();
    const tables = [];
    let rows = null;
    let headerDone = false;
    for (const raw of b.split('\n')) {
      const ln = raw.trim();
      if (!ln.startsWith('|')) {
        rows = null;
        headerDone = false;
        continue;
      }
      if (/^\|[\s:\-|]+\|?$/.test(ln)) continue; // 分隔行
      const cells = ln.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (!rows) {
        if (!headerDone) {
          // 第一行是表头
          rows = [];
          tables.push({ header: cells, rows });
          headerDone = true;
          continue;
        }
        rows = [];
        tables.push({ header: [], rows });
      }
      rows.push(cells);
    }
    sections.push({ heading: h, level, body: b, tables });
  }
  return sections;
}

/** 取 section 及其所有子节的表格（应对 ## 下按 ### 分多个业务表的情况） */
function tablesDeep(doc, section) {
  const idx = doc.indexOf(section);
  if (idx < 0) return section.tables || [];
  const out = [...(section.tables || [])];
  for (let i = idx + 1; i < doc.length; i++) {
    if (doc[i].level <= section.level) break;
    out.push(...(doc[i].tables || []));
  }
  return out;
}

/** 在 section 及子节里找第一个匹配表头的表 */
function findTableDeep(doc, section, ...headerWords) {
  const all = tablesDeep(doc, section);
  if (!headerWords.length) return all.find((t) => t.rows.length) || all[0] || null;
  for (const t of all) {
    const h = t.header.join('|').toLowerCase();
    if (headerWords.every((w) => h.includes(w.toLowerCase()))) return t;
  }
  return null;
}

/** 合并 section 及子节的所有表格数据行 */
function mergedRows(doc, section, ...headerWords) {
  const all = tablesDeep(doc, section);
  const picked = headerWords.length ? all.filter((t) => headerWords.every((w) => t.header.join('|').toLowerCase().includes(w.toLowerCase()))) : all;
  const rows = [];
  for (const t of picked) rows.push(...t.rows);
  return rows;
}

function findSection(doc, ...keywords) {
  for (const s of doc) {
    const hh = s.heading.toLowerCase();
    if (keywords.every((k) => hh.includes(k.toLowerCase()))) return s;
  }
  return null;
}

function findTable(section, ...headerWords) {
  if (!section) return null;
  if (!headerWords.length) return section.tables[0] || null;
  for (const t of section.tables) {
    const h = t.header.join('|').toLowerCase();
    if (headerWords.every((w) => h.includes(w.toLowerCase()))) return t;
  }
  return null;
}

/** 表头 -> 列索引 */
function colIdx(table, ...names) {
  if (!table) return -1;
  for (const n of names) {
    const i = table.header.findIndex((h) => h.replace(/\s/g, '').includes(n.replace(/\s/g, '')));
    if (i >= 0) return i;
  }
  return -1;
}

/** 是否模板示例行（VP-XX-001 / 例：xxx） */
function isExampleRow(cells) {
  const first = String(cells[0] || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
  if (!first) return true;
  if (/-XX-/.test(first)) return true;
  if (/^例[:：]/.test(first)) return true;
  return false;
}

/**
 * 取单元格中的勾选状态，按「勾选标记后面跟的词」判定，而不是看到 ☑ 就算通过。
 * 例：'☑ 否' → false（勾了「否」，这是失败）；'☑ 是' → true；
 *     '□ 是 □ 否 ☑ 首模块' → null（勾的是豁免项，交给调用方按文字判定）。
 * 修复前 '☑ 否' 会被判为 true，导致 04 卡里 10 项明确的「否」被门禁漏拦。
 */
function checkbox(cell) {
  const s = String(cell || '');
  const marks = [...s.matchAll(/[☑✓✔■]|\[[xX]\]/g)];
  if (marks.length) {
    const last = marks[marks.length - 1];
    const tail = s.slice(last.index + last[0].length).trim();
    if (/^否/.test(tail)) return false;
    if (/^是/.test(tail)) return true;
    if (/^(首模块|不适用|无|待定)/.test(tail)) return null;
    return null;
  }
  if (/[□☐]|\[ \]/.test(s)) return false;
  return null;
}

// ---------------- 各门检查 ----------------
function checkM1(files) {
  const R = [];
  const push = (level, id, msg, hint) => R.push({ level, id, msg, hint });

  // --- 00 模块卡 ---
  if (!files.card) {
    push('FAIL', 'M1-00', '缺少 00-模块卡.md');
  } else {
    const doc = parseDoc(files.card);

    const s11 = findSection(doc, '1.1', '数据表') || findSection(doc, '关联数据表');
    if (!s11) {
      push('FAIL', 'M1-01', '模块卡缺 §1.1 关联数据表（v1.1 要求实测证据）', '按 templates/模块卡_模板.md v1.1 补');
    } else {
      const t = findTable(s11, '表名');
      const cEv = colIdx(t, '证据来源');
      if (!t || cEv < 0) {
        push('FAIL', 'M1-01', '§1.1 表名表缺「证据来源」列');
      } else {
        const data = t.rows.filter((r) => !isExampleRow(r));
        if (!data.length) push('FAIL', 'M1-01', '§1.1 表名表为空');
        const noEv = data.filter((r) => isBlank(r[cEv]));
        if (noEv.length) push('FAIL', 'M1-01', `${noEv.length} 张表缺证据来源（文件:行号）`, '坑 3：表名不许靠猜');
      }
    }

    const s12 = findSection(doc, '1.2', 'change');
    if (!s12) {
      push('FAIL', 'M1-02', '模块卡缺 §1.2 关联 change 实测（v1.1 要求）');
    } else {
      const m = s12.body.match(/实测日期[:：]\s*(.+)/);
      if (!m || isBlank(m[1])) push('FAIL', 'M1-02', '§1.2 缺实测日期', '坑 2：change 名必须 ls 实测');
      const t = findTable(s12);
      const data = (t?.rows || []).filter((r) => !isExampleRow(r));
      if (!data.length) push('FAIL', 'M1-02', '§1.2 change 表为空');
    }
  }

  // --- 01 验收点清单 ---
  if (!files.vp) {
    push('FAIL', 'M1-10', '缺少 01-验收点清单.md');
  } else {
    const doc = parseDoc(files.vp);

    const s0 = findSection(doc, '裁决基线') || findSection(doc, '0.');
    if (!s0) {
      push('FAIL', 'M1-11', '验收点清单缺 §0 裁决基线（v1.1 新增，坑 7）');
    } else {
      const t = findTable(s0);
      const cItem = colIdx(t, '项');
      const cVal = t ? (colIdx(t, '内容') >= 0 ? colIdx(t, '内容') : cItem + 1) : -1;
      if (t && cItem >= 0) {
        const row = t.rows.find((r) => (r[cItem] || '').includes('commit'));
        if (!row || isBlank(row[cVal])) push('FAIL', 'M1-11', '§0 裁决基线 commit 未填', 'git log -1 --format=%h -- validation.md');
      }
      const m = s0.body.match(/共\s*\*{0,2}\s*(\d+)\s*\*{0,2}\s*条/);
      if (!m) push('FAIL', 'M1-12', '§0 VAL 枚举条数未填', '坑 1：先 grep 枚举 VAL 再拆 VP');
    }

    const s2 = findSection(doc, '验收点表');
    if (!s2) {
      push('FAIL', 'M1-13', '缺 §2 验收点表');
    } else {
      // 兼容 ## 验收点表 下按业务域拆成多个 ### 子表的情况
      const t = findTableDeep(doc, s2, 'VP');
      const tAll = tablesDeep(doc, s2).filter((x) => x.rows.length);
      const cSt = colIdx(t, '状态');
      const cPrio = colIdx(t, '优先级');
      const cSrc = colIdx(t, '裁决来源', '原文');
      const data = mergedRows(doc, s2).filter((r) => !isExampleRow(r) && /^VP-/.test((r[0] || '').replace(/\*\*/g, '').trim()));
      if (!data.length) push('FAIL', 'M1-13', '验收点表为空');
      if (cSt >= 0) {
        const noSt = data.filter((r) => isBlank(r[cSt]));
        if (noSt.length) push('FAIL', 'M1-13', `${noSt.length} 个 VP 状态为空`);
      }
      if (cPrio >= 0) {
        const noP = data.filter((r) => !/P[012]/i.test(r[cPrio] || ''));
        if (noP.length) push('FAIL', 'M1-13', `${noP.length} 个 VP 未定级`);
      }
      if (cSrc >= 0) {
        const noS = data.filter((r) => isBlank(r[cSrc]));
        if (noS.length) push('WARN', 'M1-13b', `${noS.length} 个 VP 缺「裁决来源」（VAL 编号+行号）`, '裁决变更时无法反查受影响 VP');
      }
      if (tAll.length > 1) {
        push('PASS', 'M1-13c', `验收点表按 ${tAll.length} 个子表组织，已合并校验（共 ${data.length} 个 VP）`);
      }
    }

    // §4 VP 评审（坑 6）
    const p0List = (() => {
      const sec = findSection(doc, '验收点表');
      if (!sec) return [];
      return mergedRows(doc, sec)
        .filter((r) => !isExampleRow(r) && /^VP-/.test((r[0] || '').replace(/\*\*/g, '').trim()))
        .filter((r) => {
          const cP = (() => {
            for (const t of tablesDeep(doc, sec)) {
              const i = colIdx(t, '优先级');
              if (i >= 0 && t.rows.includes(r)) return i;
            }
            return -1;
          })();
          return cP >= 0 && /P0/i.test(r[cP] || '');
        })
        .map((r) => (r[0] || '').replace(/\*\*/g, '').trim());
    })();
    const s41 = findSection(doc, '4.1', '产品');
    const s42 = findSection(doc, '4.2', '开发');
    if (!s41 || !s42) {
      push('FAIL', 'M1-14', '缺 §4 VP 评审记录（v1.1 新增，坑 6）');
    } else {
      const empty = (c) => c === undefined || c === null || String(c).trim() === '' || isBlank(c);
      for (const [sec, tag, name] of [[s41, 'M1-14a', '产品'], [s42, 'M1-14b', '开发']]) {
        const t = findTable(sec);
        const cId = colIdx(t, 'VP');
        const cWho = colIdx(t, '确认人');
        const cDate = colIdx(t, '日期');
        const cAns = colIdx(t, '产品确认', '已编码');
        const data = (t?.rows || []).filter((r) => !isExampleRow(r));
        for (const vp of p0List) {
          const row = data.find((r) => (r[cId] || '').includes(vp));
          if (!row) {
            push('FAIL', tag, `P0 验收点 ${vp} 未完成${name}确认`, '坑 6：P0 必须经产品定级 + 开发确认是否已编码');
            continue;
          }
          // 只判断「VP 编号是否出现」是不够的：模板示例行本身就带编号，
          // 必须同时校验结论已勾选 + 确认人 + 日期，否则签字制度形同虚设。
          const missing = [];
          if (cWho >= 0 && empty(row[cWho])) missing.push('确认人');
          if (cDate >= 0 && empty(row[cDate])) missing.push('日期');
          if (cAns >= 0 && !/[☑✓✔■]|\[[xX]\]/.test(row[cAns] || '')) missing.push('结论未勾选');
          if (missing.length) {
            push('FAIL', tag, `P0 ${vp} 的${name}确认不完整（缺 ${missing.join('、')}）`, '确认单签字后须回填到 01 §4，门禁只认正式文档');
          }
        }
      }
    }

    // §5 裁决变更清单（有冲突就必须登记）
    const s5 = findSection(doc, '裁决变更');
    const hasConflictFlag = findSection(doc, '0.2', '裁决对账');
    if (!s5 && !hasConflictFlag) {
      push('WARN', 'M1-15', '缺 §5 裁决变更清单（若本模块无裁决冲突可忽略）');
    }
  }

  // --- 02 用例归属 ---
  if (!files.map) {
    push('FAIL', 'M1-20', '缺少 02-用例与自动化归属.md');
  } else {
    const doc = parseDoc(files.map);

    const s01 = findSection(doc, '0.1', '导出');
    if (!s01) {
      push('FAIL', 'M1-21', '缺 §0.1 V5 导出记录（v1.1 强制前置，坑 7）');
    } else {
      const t = findTable(s01);
      const cItem = colIdx(t, '项');
      const cVal = t ? (colIdx(t, '内容') >= 0 ? colIdx(t, '内容') : cItem + 1) : -1;
      if (t && cItem >= 0) {
        const row = t.rows.find((r) => (r[cItem] || '').includes('导出行数'));
        if (!row || isBlank(row[cVal])) push('FAIL', 'M1-21', '§0.1 导出行数未填', '未导出 V5，「无用例」结论不可信');
      }
    }

    const s03 = findSection(doc, '覆盖矩阵');
    if (!s03) {
      push('FAIL', 'M1-23', '缺 §3 覆盖矩阵');
    } else {
      const t = findTable(s03);
      const cPrio = colIdx(t, '优先级');
      const cSt = colIdx(t, '自动化状态');
      const data = (t?.rows || []).filter((r) => !isExampleRow(r));
      if (cSt < 0) {
        push('FAIL', 'M1-23', '覆盖矩阵缺「自动化状态」列（v1.1 四态口径）');
      } else {
        const bad = data.filter((r) => /P0/i.test(r[cPrio] || '') && !/已通过/.test(r[cSt] || ''));
        for (const r of bad) {
          const vp = (r[0] || '').replace(/\*\*/g, '').trim();
          const st = (r[cSt] || '').replace(/\*\*/g, '').trim() || '(空)';
          push('FAIL', 'M1-24', `P0 ${vp} 自动化状态为「${st}」`, '坑 4：只有「已通过」才算覆盖，其余按缺口');
        }
      }
    }

    const s5m = findSection(doc, '汇总');
    if (!s5m) push('WARN', 'M1-25', '缺 §5 汇总');
  }

  return R;
}

function checkM2(files) {
  const R = [];
  const push = (l, id, m, h) => R.push({ level: l, id, msg: m, hint: h });

  if (!files.rec) {
    push('FAIL', 'M2-00', '缺少 03-验证记录.md');
    return R;
  }
  const doc = parseDoc(files.rec);

  const s0 = findSection(doc, '自动化执行证据') || findSection(doc, '0.');
  if (!s0) {
    push('FAIL', 'M2-01', '缺 §0 自动化执行证据（v1.1 新增，坑 5）');
    return R;
  }
  const t = findTable(s0);
  if (!t) {
    push('FAIL', 'M2-01', '§0 表格缺失');
    return R;
  }
  const cLayer = colIdx(t, '层级');
  const cTime = colIdx(t, '执行时间');
  const cFile = colIdx(t, '结果文件');
  const cRes = colIdx(t, '通过');
  const data = t.rows.filter((r) => !isExampleRow(r) || (r[cLayer] || '').startsWith('L'));
  const realRows = t.rows.filter((r) => /^L/.test((r[cLayer] || '').replace(/\*\*/g, '').trim()));

  if (!realRows.length) push('FAIL', 'M2-01', '§0 没有任何层级行');

  for (const r of realRows) {
    const layer = (r[cLayer] || '').replace(/\*\*/g, '').trim();
    const time = (r[cTime] || '').trim();
    const body = r.join(' ');
    if (isBlank(time)) {
      push('FAIL', 'M2-02', `${layer} 未填执行时间`, '坑 5：没有时间戳的「已通过」无效');
    }
    if (isBlank(r[cFile]) && !/未建立|不涉及|N\/A/.test(body)) {
      push('WARN', 'M2-02b', `${layer} 未填结果文件路径`);
    }
    if (/有失败|失败/.test(r[cRes] || '')) {
      push('FAIL', 'M2-03', `${layer} 结论为「有失败」`, '依赖层有失败 → 只能阻断，不得准出');
    }
  }

  // 存量失败是否判定影响
  const s0b = findSection(doc, '已知存量失败') || s0;
  const tStock = findTable(s0b, '存量失败');
  if (tStock) {
    const cImpact = colIdx(tStock, '影响');
    const rows = tStock.rows.filter((r) => !isExampleRow(r));
    const undecided = rows.filter((r) => {
      if (isBlank(r[0])) return false;
      if (cImpact < 0) return true;
      return checkbox(r[cImpact]) === null;
    });
    if (undecided.length) push('WARN', 'M2-04', `${undecided.length} 条存量失败未判定是否影响本模块结论`);
  }

  // G-M2 门结论
  const s6 = findSection(doc, '本轮结论');
  if (s6) {
    const m = s6.body.match(/G-M2[^\n]*?([□☐][^\n]*)/);
    if (m) {
      const hasYes = /[☑✓✔■]/.test(m[1]);
      const hasNo = /[☑✓✔■][^\n]{0,4}否/.test(s6.body);
      if (!hasYes) push('FAIL', 'M2-05', 'G-M2 门结论未勾选');
      else if (hasNo) push('FAIL', 'M2-05', 'G-M2 判定为「否」');
    } else {
      push('WARN', 'M2-05', '未找到 G-M2 门结论行');
    }
  }

  return R;
}

function checkM3(files) {
  const R = [];
  const push = (l, id, m, h) => R.push({ level: l, id, msg: m, hint: h });

  if (!files.exit) {
    push('FAIL', 'M3-00', '缺少 04-准出卡.md');
    return R;
  }
  const doc = parseDoc(files.exit);

  // §0 自动化健康度
  const s0 = findSection(doc, '自动化健康度');
  if (!s0) {
    push('FAIL', 'M3-01', '缺 §0 自动化健康度（v1.1 新增，坑 5）');
  } else {
    const t = findTable(s0);
    const cLayer = colIdx(t, '层级');
    const cConcl = colIdx(t, '结论');
    const rows = (t?.rows || []).filter((r) => /^L/.test((r[0] || '').replace(/\*\*/g, '').trim()));
    if (!rows.length) push('FAIL', 'M3-01', '§0 无层级行');
    for (const r of rows) {
      const layer = (r[cLayer] || '').replace(/\*\*/g, '').trim();
      if (cConcl >= 0 && isBlank(r[cConcl])) push('FAIL', 'M3-02', `${layer} 结论未填`);
      if (/有失败/.test(r[cConcl] || '')) push('FAIL', 'M3-03', `${layer} 有失败，不得准出`);
    }
  }

  // §2 十二项检查
  const s2 = findSection(doc, 'G-M3');
  if (!s2) {
    push('FAIL', 'M3-04', '缺 §2 G-M3 检查表');
  } else {
    const t = findTable(s2, '检查项');
    const cChk = colIdx(t, '检查项');
    const cRes = colIdx(t, '结果');
    const rows = (t?.rows || []).filter((r) => !isExampleRow(r));
    if (rows.length < 12) push('WARN', 'M3-04b', `G-M3 检查项仅 ${rows.length} 项（v1.1 应为 12 项）`);
    for (const r of rows) {
      const name = ((r[cChk] || '') + '').replace(/\*\*/g, '').trim();
      const cell = r[cRes] || '';
      const st = checkbox(cell);
      if (st === null) {
        push('WARN', 'M3-05', `检查项「${name.slice(0, 22)}」未明确勾选`, '把选中的 □ 改为 ☑');
      } else if (st === false && !/不适用|无/.test(cell)) {
        push('FAIL', 'M3-06', `检查项「${name.slice(0, 22)}」为「否」`, '硬条件为否则不得判「准出」');
      }
    }
  }

  // §4 判定
  const s4 = findSection(doc, '判定');
  if (s4) {
    const boxes = s4.body.match(/\[[ xX☑✓]\]/g) || [];
    const checked = (s4.body.match(/\[[xX☑✓]\]/g) || []).length;
    if (checked === 0) push('FAIL', 'M3-07', '§4 未勾选判定结论（准出/条件准出/阻断）');
    if (checked > 1) push('WARN', 'M3-07b', '§4 勾选了多个判定，应只有一个');
  } else {
    push('FAIL', 'M3-07', '缺 §4 判定');
  }

  // §5 签字
  const s5 = findSection(doc, '签字') || findSection(doc, '5.');
  if (s5) {
    const rows = (findTable(s5)?.rows || []).filter((r) => !isExampleRow(r));
    const noName = rows.filter((r) => isBlank(r[1]));
    if (noName.length) push('FAIL', 'M3-08', `${noName.length} 个签字角色未签名`);
  }

  return R;
}

// ---------------- 主流程 ----------------
function checkOne(dir) {
  const files = {};
  for (const [k, name] of Object.entries(FILES)) {
    const p = path.join(dir, name);
    files[k] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
  }

  const result = { dir, module: path.basename(dir), gates: {}, version: 'v1.1' };
  const run = (g, fn) => {
    if (gate !== 'ALL' && gate !== g) return;
    const r = fn(files);
    result.gates[g] = {
      pass: r.filter((x) => x.level === 'PASS').length,
      warn: r.filter((x) => x.level === 'WARN').length,
      fail: r.filter((x) => x.level === 'FAIL').length,
      items: r,
    };
  };
  run('M1', checkM1);
  run('M2', checkM2);
  run('M3', checkM3);

  // 文档版本识别：v1.0 文档缺少 v1.1 关键节
  if (files.vp && !/裁决基线/.test(files.vp)) result.docVersion = 'v1.0';
  else if (files.vp) result.docVersion = 'v1.1';
  else result.docVersion = '未知';

  return result;
}

function printOne(res) {
  const L = [];
  const line = (s) => L.push(s);
  line('');
  line(`━━━ ${res.module} ━━━`);
  if (res.docVersion === 'v1.0') {
    line(`  ⚠ 检测到 v1.0 文档（缺 §0 裁决基线）。请按 templates v1.1 升级后再过门。`);
  }
  let anyFail = 0;
  for (const g of ['M1', 'M2', 'M3']) {
    const r = res.gates[g];
    if (!r) continue;
    const icon = r.fail ? '✗' : r.warn ? '!' : '✓';
    line(`  ${icon} ${g}  fail=${r.fail} warn=${r.warn}`);
    anyFail += r.fail;
    for (const it of r.items) {
      const pre = it.level === 'FAIL' ? '    ✗' : it.level === 'WARN' ? '    !' : '    ✓';
      line(`${pre} [${it.id}] ${it.msg}`);
      if (it.hint) line(`        → ${it.hint}`);
    }
  }
  console.log(L.join('\n'));
  return anyFail;
}

// ---------------- 运行 ----------------
const target = path.resolve(positionals[0]);
if (!fs.existsSync(target)) {
  console.error(`路径不存在: ${target}`);
  process.exit(2);
}

let dirs = [];
if (scanAll) {
  dirs = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(target, d.name))
    .filter((d) => fs.existsSync(path.join(d, FILES.card)) || fs.existsSync(path.join(d, FILES.vp)));
} else {
  dirs = [target];
}

const results = dirs.map(checkOne);
let totalFail = 0;
if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
  totalFail = results.reduce((a, r) => a + Object.values(r.gates).reduce((x, g) => x + g.fail, 0), 0);
} else {
  for (const r of results) totalFail += printOne(r);
  console.log('');
  console.log(`━━━ 汇总：${results.length} 个模块，${totalFail} 项 FAIL ━━━`);
  if (totalFail) console.log('门禁未通过。修复 FAIL 项后重跑。');
  else console.log('门禁通过（WARN 项请人工确认）。');
}

process.exit(totalFail > 0 ? 1 : 0);
