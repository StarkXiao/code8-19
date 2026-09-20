// 前端冒烟测试：happy-dom 加载真实 index.html + app.js，fetch 桥接到真实后端。
// 覆盖：仪表盘渲染 → 列表 → 状态过滤 → 详情 → 逾期节点填报 → 记录落库渲染。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';
import { Window } from 'happy-dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3212';
const TEST_DB = path.join(ROOT, 'data', 'test-ui.db');

process.env.PORT = '3212';
process.env.DB_FILE = 'data/test-ui.db';

// 1) 准备测试库（种子数据）
spawnSync('node', ['scripts/reset-db.mjs', '--force'], { cwd: ROOT, env: process.env, stdio: 'ignore' });

// 2) 启动真实后端（import 即监听）
const { server } = await import('../src/server.mjs');

// 3) 搭建浏览器环境
const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const window = new Window({ url: `${BASE}/#/dashboard` });
window.document.write(html);

globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.location = window.location;
globalThis.FormData = window.FormData;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;

// 相对路径的 fetch 拼上后端基址
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  let url = typeof input === 'string' ? input : input?.url;
  if (url && url.startsWith('/')) url = BASE + url;
  return nativeFetch(url, init);
};

async function waitFor(fn, timeout = 4000) {
  const start = Date.now();
  let err;
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 25));
    try {
      const v = fn();
      if (v) return v;
    } catch (e) {
      err = e;
    }
  }
  throw new Error(`waitFor 超时: ${err?.message || '条件未达成'}`);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

before(async () => {
  await import(`../public/app.js?${Date.now()}`);
});

test('仪表盘：统计卡片与状态分布渲染', async () => {
  await waitFor(() => document.body.textContent.includes('在册古树'));
  const text = $('#app').textContent;
  assert.ok(text.includes('逾期未跟踪节点'));
  assert.ok(text.includes('复壮成功率'));
  // 种子 5 株
  const nums = $$('.stat .num').map((e) => e.textContent.trim());
  assert.ok(nums.includes('5'));
  // 香樟有一个逾期节点 → 待办区出现"逾期"
  assert.ok(text.includes('逾期'));
});

test('档案列表：表格 5 行，状态过滤生效', async () => {
  window.location.hash = '#/trees';
  await waitFor(() => $$('table tbody tr').length === 5);

  // 搜索"银杏"
  const search = $('#q');
  search.value = '银杏';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => $$('table tbody tr').length === 1);
  assert.ok($('table tbody tr').textContent.includes('银杏'));

  // 清空搜索，按状态过滤"两年跟踪中"
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => $$('table tbody tr').length === 5);
  const sel = $('#status');
  sel.value = 'tracking';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => {
    const rows = $$('table tbody tr');
    return rows.length === 1 && rows[0].textContent.includes('香樟');
  });
});

test('详情页：香樟显示逾期的 9 月节点，填报后变为已填报', async () => {
  // 直接通过 API 拿到香樟 id
  const res = await nativeFetch(`${BASE}/api/trees?status=tracking`);
  const [camphor] = await res.json();

  window.location.hash = `#/trees/${camphor.id}`;
  await waitFor(() => document.body.textContent.includes('两年存活跟踪'));
  assert.ok($('#app').textContent.includes('基线（复壮完成日）'));

  // 找到 9 月节点卡片上的"填报"按钮
  const fill9 = await waitFor(() => $$('button[data-node-fill]').find((b) => b.dataset.nodeFill === '9'));
  assert.ok(fill9.textContent.trim() === '填报');
  fill9.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // 弹窗出现
  const form = await waitFor(() => $('#modal-form'));
  // 默认存活/生长势正常，只需设置日期（基线 + 9 月）
  const dueNode = camphor.tracking.nodes.find((n) => n.month === 9);
  form.querySelector('[name=followupDate]').value = dueNode.dueDate;
  form.querySelector('[name=observer]').value = '测试观察人';
  form.requestSubmit();

  // 弹窗关闭、9 月记录出现
  await waitFor(() => !$('#modal-form'));
  await waitFor(() => document.body.textContent.includes('第 9 月'));
  const node9 = $$('.node').find((n) => n.textContent.includes('第 9 月'));
  assert.ok(node9.textContent.includes('已填报'));
  assert.ok(node9.textContent.includes('正常'));
});

test('详情页：未完成全部措施的国槐不能启动跟踪，显示警告横幅', async () => {
  const res = await nativeFetch(`${BASE}/api/trees?status=treating`);
  const [locust] = await res.json();
  window.location.hash = `#/trees/${locust.id}`;
  await waitFor(() => document.body.textContent.includes('两年存活跟踪'));
  assert.ok(!$('[id="btn-start-followup"]'));
  assert.ok($('#app').textContent.includes('项措施未完成'));
});

test('打印版汇总包含三张表', async () => {
  // 国槐详情仍在，打印汇总应已注入
  const summary = $('#print-summary');
  assert.ok(summary.textContent.includes('体检结论'));
  assert.ok(summary.textContent.includes('复壮措施'));
  assert.ok(summary.textContent.includes('两年存活跟踪'));
});

test.after(async () => {
  await rm(TEST_DB, { force: true });
  await new Promise((resolve) => server.close(resolve));
});
