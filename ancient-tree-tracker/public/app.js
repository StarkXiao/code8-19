/* 古树名木复壮跟踪系统 —— 前端（无框架、无构建）
 * 路由：#/dashboard  #/trees  #/trees/:id
 */
'use strict';

// ---------------------------------------------------------------- 状态与 API

const state = {
  constants: null,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) {
    const msg = data?.error?.message || `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data;
}

async function ensureConstants() {
  if (!state.constants) state.constants = await api('/api/constants');
  return state.constants;
}

// ---------------------------------------------------------------- 小工具

const C = {
  label(list, value) {
    return list.find((x) => x.value === value)?.label || value || '—';
  },
  labels(list, values) {
    return (values || []).map((v) => C.label(list, v));
  },
  esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  fmtDate(s) {
    return s || '—';
  },
  yuan(n) {
    return n == null ? '—' : `¥${Number(n).toLocaleString('zh-CN')}`;
  },
};

const $app = document.getElementById('app');

function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

async function withToast(promise, okMsg) {
  try {
    const r = await promise;
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'err');
    throw e;
  }
}

function badgeClass(status) {
  return `badge badge-${status}`;
}

// ---------------------------------------------------------------- 通用弹窗表单

/**
 * 字段定义：
 * { name, label, type: text|date|number|textarea|select|multiselect|radio,
 *   required, options:[{value,label}], placeholder, hint, span:2, defaultValue }
 */
function openFormModal({ title, fields, submitText = '保存', wide = false, onSubmit }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask">
      <div class="modal ${wide ? 'wide' : ''}">
        <div class="modal-head">
          <h3>${C.esc(title)}</h3>
          <button class="modal-close" data-close>×</button>
        </div>
        <form id="modal-form" autocomplete="off">
          <div class="modal-body">
            <div class="form-grid">
              ${fields
                .map((f) => {
                  const cls = f.span === 2 ? 'field full' : 'field';
                  const req = f.required ? '<span class="req">*</span>' : '';
                  const defVal = f.defaultValue ?? '';
                  let input = '';
                  if (f.type === 'textarea') {
                    input = `<textarea name="${f.name}" placeholder="${C.esc(f.placeholder || '')}"
                      ${f.required ? 'required' : ''}>${C.esc(defVal)}</textarea>`;
                  } else if (f.type === 'select') {
                    input = `<select name="${f.name}" ${f.required ? 'required' : ''}>
                      <option value="">请选择…</option>
                      ${f.options
                        .map(
                          (o) =>
                            `<option value="${C.esc(o.value)}" ${o.value === defVal ? 'selected' : ''}>${C.esc(o.label)}</option>`
                        )
                        .join('')}
                    </select>`;
                  } else if (f.type === 'multiselect') {
                    const selected = new Set(Array.isArray(defVal) ? defVal : []);
                    input = `<div class="checkgrid">${f.options
                      .map(
                        (o) =>
                          `<label><input type="checkbox" name="${f.name}" value="${C.esc(o.value)}" ${
                            selected.has(o.value) ? 'checked' : ''
                          }/>${C.esc(o.label)}</label>`
                      )
                      .join('')}</div>`;
                  } else if (f.type === 'radio') {
                    input = `<div class="radio-line">${f.options
                      .map(
                        (o) =>
                          `<label><input type="radio" name="${f.name}" value="${C.esc(o.value)}" ${
                            o.value === defVal ? 'checked' : ''
                          } ${f.required ? 'required' : ''}/>${C.esc(o.label)}</label>`
                      )
                      .join('')}</div>`;
                  } else {
                    input = `<input type="${f.type}" name="${f.name}" value="${C.esc(defVal)}"
                      placeholder="${C.esc(f.placeholder || '')}" ${f.required ? 'required' : ''}
                      ${f.attrs || ''}/>`;
                  }
                  return `<div class="${cls}">
                    <label>${C.esc(f.label)} ${req}</label>
                    ${input}
                    ${f.hint ? `<span class="hint">${C.esc(f.hint)}</span>` : ''}
                  </div>`;
                })
                .join('')}
            </div>
            <div id="modal-error" class="field-error" style="margin-top:8px"></div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn ghost" data-close>取消</button>
            <button type="submit" class="btn">${C.esc(submitText)}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => (root.innerHTML = '');
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.querySelector('.modal-mask').addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) close();
  });

  const form = root.querySelector('#modal-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {};
    for (const f of fields) {
      if (f.type === 'multiselect') {
        payload[f.name] = fd.getAll(f.name);
      } else if (f.type === 'number') {
        const raw = fd.get(f.name);
        payload[f.name] = raw === '' || raw === null ? null : Number(raw);
      } else {
        payload[f.name] = (fd.get(f.name) || '').toString().trim();
      }
    }
    const errBox = root.querySelector('#modal-error');
    errBox.textContent = '';
    try {
      await onSubmit(payload, close);
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}

function confirmModal(message, actionText, onConfirm) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask"><div class="modal" style="max-width:420px">
      <div class="modal-head"><h3>请确认</h3><button class="modal-close" data-close>×</button></div>
      <div class="modal-body"><div>${C.esc(message)}</div></div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn danger" id="confirm-ok">${C.esc(actionText)}</button>
      </div>
    </div></div>`;
  const close = () => (root.innerHTML = '');
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.querySelector('#confirm-ok').addEventListener('click', async () => {
    try {
      await onConfirm(close);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
}

// ---------------------------------------------------------------- 字段库

function treeFields(constants, t = {}) {
  return [
    { name: 'species', label: '树种（中文名）', required: true, defaultValue: t.species, placeholder: '如：银杏' },
    { name: 'latinName', label: '拉丁名', defaultValue: t.latinName, placeholder: 'Ginkgo biloba L.' },
    { name: 'grade', label: '古树等级', type: 'select', required: true, options: constants.grades, defaultValue: t.grade },
    { name: 'estimatedAge', label: '估测树龄（年）', type: 'number', required: true, defaultValue: t.estimatedAge, attrs: 'min=0 max=9999' },
    { name: 'location', label: '生长位置', required: true, span: 2, defaultValue: t.location, placeholder: '具体到门牌/地标' },
    { name: 'longitude', label: '经度', type: 'number', defaultValue: t.longitude, attrs: 'step=0.000001 min=-180 max=180' },
    { name: 'latitude', label: '纬度', type: 'number', defaultValue: t.latitude, attrs: 'step=0.000001 min=-90 max=90' },
    { name: 'heightM', label: '树高（m）', type: 'number', defaultValue: t.heightM, attrs: 'step=0.1 min=0' },
    { name: 'dbhCm', label: '胸径（cm）', type: 'number', defaultValue: t.dbhCm, attrs: 'step=0.1 min=0' },
    { name: 'crownWidthM', label: '冠幅（m）', type: 'number', defaultValue: t.crownWidthM, attrs: 'step=0.1 min=0' },
    { name: 'ownerUnit', label: '权属/管养单位', defaultValue: t.ownerUnit },
    { name: 'custodian', label: '养护责任人', defaultValue: t.custodian },
    { name: 'custodianPhone', label: '责任人电话', defaultValue: t.custodianPhone },
    { name: 'remark', label: '备注', type: 'textarea', span: 2, defaultValue: t.remark },
  ];
}

function examFields(constants, today) {
  return [
    { name: 'examDate', label: '体检日期', type: 'date', required: true, defaultValue: today },
    { name: 'vigor', label: '生长势', type: 'radio', required: true, options: constants.vigors, defaultValue: 'weak' },
    { name: 'issues', label: '发现的问题（可多选）', type: 'multiselect', span: 2, options: constants.issueTypes },
    { name: 'diagnosis', label: '诊断结论与处置建议', type: 'textarea', span: 2, required: false, placeholder: '树体现状、病因分析、建议措施……' },
    { name: 'examiner', label: '体检人/专家组' },
    { name: 'organization', label: '体检单位' },
  ];
}

function measureFields(constants, m = {}, defaults = {}) {
  return [
    { name: 'types', label: '复壮措施（可多选）', type: 'multiselect', span: 2, required: true, options: constants.measureTypes, defaultValue: m.types || [] },
    { name: 'detail', label: '措施内容/工艺说明', type: 'textarea', span: 2, defaultValue: m.detail || '' },
    { name: 'plannedStart', label: '计划开始', type: 'date', required: true, defaultValue: m.plannedStart || defaults.today },
    { name: 'plannedEnd', label: '计划完成', type: 'date', required: true, defaultValue: m.plannedEnd || defaults.today },
    {
      name: 'status',
      label: '状态',
      type: 'radio',
      required: true,
      options: constants.measureStatuses,
      defaultValue: m.status || 'planned',
    },
    { name: 'actualEnd', label: '实际完成日期', type: 'date', defaultValue: m.actualEnd || '', hint: '状态为"已完成"时必填' },
    { name: 'organization', label: '施工单位', defaultValue: m.organization || '' },
    { name: 'costYuan', label: '费用（元）', type: 'number', defaultValue: m.costYuan ?? '', attrs: 'min=0 step=0.01' },
    { name: 'remark', label: '备注', type: 'textarea', span: 2, defaultValue: m.remark || '' },
  ];
}

function followupFields(constants, { month, baselineDate, today }) {
  const due = month ? addMonthsClient(baselineDate, month) : '';
  return [
    ...(month
      ? [{ name: '_month', label: '跟踪节点', defaultValue: `第 ${month} 月（应于 ${due} 前后填报）`, attrs: 'disabled' }]
      : [{ name: '_month', label: '临时随访', defaultValue: '计划外的现场巡查记录', attrs: 'disabled' }]),
    { name: 'followupDate', label: '跟踪日期', type: 'date', required: true, defaultValue: today },
    {
      name: 'alive',
      label: '存活情况',
      type: 'radio',
      required: true,
      options: [
        { value: 'true', label: '存活' },
        { value: 'false', label: '死亡' },
      ],
      defaultValue: 'true',
    },
    { name: 'vigor', label: '生长势', type: 'radio', required: true, options: constants.vigors, defaultValue: 'normal' },
    { name: 'newIssues', label: '新发现问题（可多选）', type: 'multiselect', span: 2, options: constants.issueTypes },
    { name: 'newMeasures', label: '现场处置/养护建议', type: 'textarea', span: 2 },
    { name: 'observer', label: '跟踪观察人' },
    { name: 'remark', label: '备注', type: 'textarea', span: 2 },
  ];
}

// 前端也需要月份推算（显示应到日期）
function addMonthsClient(baseISO, months) {
  const [y, m, d] = baseISO.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 页面：仪表盘

async function renderDashboard() {
  const [constants, stats] = await Promise.all([ensureConstants(), api('/api/stats')]);
  const statusMeta = {
    normal_care: '正常养护',
    treating: '复壮中',
    tracking: '两年跟踪中',
    closed_success: '复壮成功',
    closed_failed: '复壮失败',
  };

  $app.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="num">${stats.total}</div><div class="label">在册古树（株）</div></div>
      <div class="stat ${stats.overdueCount ? 'warn' : ''}"><div class="num">${stats.overdueCount}</div><div class="label">逾期未跟踪节点</div></div>
      <div class="stat blue"><div class="num">${stats.tracked}</div><div class="label">进入两年跟踪</div></div>
      <div class="stat"><div class="num">${stats.success}</div><div class="label">复壮成功结案</div></div>
      <div class="stat ${stats.failed ? 'warn' : ''}"><div class="num">${stats.failed}</div><div class="label">跟踪期死亡</div></div>
      <div class="stat amber"><div class="num">${stats.successRate == null ? '—' : stats.successRate + '%'}</div><div class="label">已结案复壮成功率</div></div>
    </div>

    <div class="card">
      <h2>状态分布</h2>
      <div class="stat-grid" style="margin-bottom:0">
        ${Object.entries(statusMeta)
          .map(
            ([k, label]) => `
          <div class="stat" style="border-top-color: var(--green-500)">
            <div class="num"><a href="#/trees?status=${k}">${stats.byStatus[k] || 0}</a></div>
            <div class="label">${label}</div>
          </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="card">
      <h2>待办事项 <span class="sub">按到期日排序，逾期置顶标红</span></h2>
      ${
        stats.todos.length === 0
          ? '<div class="empty"><span class="icon">✅</span>暂无待办：所有跟踪节点均在期内，或尚未启动跟踪。</div>'
          : stats.todos
              .map((t) => {
                const overdue = t.overdueDays > 0;
                return `
                <div class="todo-item ${overdue ? 'overdue' : ''}">
                  <div class="when">
                    ${overdue ? `<span class="badge badge-overdue">逾期 ${t.overdueDays} 天</span>` : `<span class="badge badge-pending">${C.fmtDate(t.dueDate)} 到期</span>`}
                  </div>
                  <div class="what">
                    <a href="#/trees/${t.treeId}"><strong>${C.esc(t.species)}</strong>（${C.esc(t.code)}）</a>
                    <div class="muted small">
                      ${t.month ? `第 ${t.month} 月跟踪节点（应于 ${C.fmtDate(t.dueDate)} 填报）` : C.esc(t.reason || '')}
                      · ${C.esc(t.location)}
                    </div>
                  </div>
                  <a class="btn sm secondary" href="#/trees/${t.treeId}">去处理</a>
                </div>`;
              })
              .join('')
      }
    </div>

    <p class="muted small">统计基准日期：${constants.today}（两年跟踪节点以复壮措施最后实际完成日为基线，第 3/6/9/12/18/24 月各填报一次）</p>`;
}

// ---------------------------------------------------------------- 页面：列表

const listState = { q: '', status: '', typing: false };

async function renderListPage() {
  const constants = await ensureConstants();
  const hash = location.hash.match(/^#\/trees(?:\?(.+))?$/);
  const params = new URLSearchParams(hash?.[1] || '');
  listState.q = params.get('q') || '';
  listState.status = params.get('status') || '';

  const trees = await api(
    `/api/trees?q=${encodeURIComponent(listState.q)}&status=${encodeURIComponent(listState.status)}`
  );

  const statusOptions = [
    { value: '', label: '全部状态' },
    { value: 'normal_care', label: '正常养护' },
    { value: 'treating', label: '复壮中' },
    { value: 'tracking', label: '两年跟踪中' },
    { value: 'closed_success', label: '复壮成功（已结案）' },
    { value: 'closed_failed', label: '复壮失败（已结案）' },
  ];

  $app.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input type="search" id="q" placeholder="搜索编号 / 树种 / 位置 / 责任人…" value="${C.esc(listState.q)}"/>
        <select id="status">${statusOptions
          .map((o) => `<option value="${o.value}" ${o.value === listState.status ? 'selected' : ''}>${o.label}</option>`)
          .join('')}</select>
        <div class="spacer"></div>
        <button class="btn" id="new-tree">＋ 新建立档</button>
      </div>
      <div class="table-wrap">
        ${
          trees.length === 0
            ? '<div class="empty"><span class="icon">🌱</span>没有符合条件的古树档案</div>'
            : `<table>
          <thead><tr>
            <th>档案编号</th><th>树种</th><th>等级</th><th>树龄</th><th>位置</th>
            <th>最近体检</th><th>状态</th><th>跟踪待办</th>
          </tr></thead>
          <tbody>
            ${trees
              .map((t) => {
                const next = t.nextDue;
                return `<tr>
                  <td><a href="#/trees/${t.id}"><code>${C.esc(t.code)}</code></a></td>
                  <td><a href="#/trees/${t.id}"><strong>${C.esc(t.species)}</strong></a>${
                    t.latinName ? `<div class="muted small">${C.esc(t.latinName)}</div>` : ''
                  }</td>
                  <td>${C.esc(C.label(constants.grades, t.grade))}</td>
                  <td>${t.estimatedAge} 年</td>
                  <td>${C.esc(t.location)}</td>
                  <td>${
                    t.latestExam
                      ? `<span class="${
                          ['weak', 'endangered', 'dead'].includes(t.latestExam.vigor) ? '' : 'muted'
                        } small">${C.fmtDate(t.latestExam.examDate)}</span>
                         <span class="badge badge-${t.latestExam.vigor}">${C.label(constants.vigors, t.latestExam.vigor)}</span>`
                      : '<span class="muted small">未体检</span>'
                  }</td>
                  <td><span class="${badgeClass(t.status)}">${t.statusLabel}</span></td>
                  <td>${
                    next
                      ? next.overdueDays > 0
                        ? `<span class="badge badge-overdue">${next.month}月节点逾期${next.overdueDays}天</span>`
                        : `<span class="badge badge-pending">${next.month}月 · ${next.dueDate}</span>`
                      : '<span class="muted small">—</span>'
                  }</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
        }
      </div>
    </div>`;

  document.getElementById('new-tree').addEventListener('click', () => {
    openFormModal({
      title: '新建立档（古树名木档案）',
      fields: treeFields(constants),
      submitText: '建立档案',
      wide: true,
      onSubmit: async (payload, close) => {
        const t = await withToast(api('/api/trees', { method: 'POST', body: payload }), '档案已建立');
        close();
        location.hash = `#/trees/${t.id}`;
      },
    });
  });

  let timer;
  const q = document.getElementById('q');
  // 输入触发重渲染后恢复焦点与光标
  if (listState.typing) {
    q.focus();
    const pos = q.value.length;
    q.setSelectionRange(pos, pos);
    listState.typing = false;
  }
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      listState.typing = true;
      listState.q = q.value.trim();
      location.hash = `#/trees?q=${encodeURIComponent(listState.q)}&status=${listState.status}`;
    }, 300);
  });
  document.getElementById('status').addEventListener('change', (e) => {
    listState.status = e.target.value;
    location.hash = `#/trees?q=${encodeURIComponent(listState.q)}&status=${listState.status}`;
  });
}

// ---------------------------------------------------------------- 页面：详情

async function renderDetail(id) {
  const [constants, t] = await Promise.all([
    ensureConstants(),
    api(`/api/trees/${id}`).catch((e) => {
      if (e.message.includes('不存在')) return null;
      throw e;
    }),
  ]);

  if (!t) {
    $app.innerHTML = `<div class="card"><div class="empty"><span class="icon">🔍</span>档案不存在或已移除。<br/><br/><a class="btn" href="#/trees">返回列表</a></div></div>`;
    return;
  }

  const tr = t.tracking;

  $app.innerHTML = `
    <p class="no-print"><a href="#/trees">← 返回档案列表</a></p>

    <div class="card" id="print-zone">
      <div class="detail-head">
        <div>
          <h1>${C.esc(t.species)} ${t.latinName ? `<span class="muted" style="font-size:14px">${C.esc(t.latinName)}</span>` : ''}</h1>
          <div class="code">档案编号 ${C.esc(t.code)}　建档时间 ${C.fmtDate(t.createdAt?.slice(0, 10))}</div>
        </div>
        <div class="spacer"></div>
        <span class="${badgeClass(t.status)}" style="font-size:13px;padding:4px 14px">${t.statusLabel}</span>
        <button class="btn secondary sm no-print" id="btn-edit">编辑档案</button>
        <button class="btn ghost sm no-print" id="btn-print">🖨 打印档案</button>
      </div>

      <hr style="border:0;border-top:1px solid var(--gray-200);margin:14px 0"/>

      <div class="kv-grid">
        ${kv('古树等级', C.label(constants.grades, t.grade))}
        ${kv('估测树龄', `${t.estimatedAge} 年`)}
        ${kv('树高', t.heightM ? `${t.heightM} m` : '—')}
        ${kv('胸径', t.dbhCm ? `${t.dbhCm} cm` : '—')}
        ${kv('冠幅', t.crownWidthM ? `${t.crownWidthM} m` : '—')}
        ${kv('生长位置', t.location)}
        ${t.longitude || t.latitude ? kv('经纬度', `${t.longitude ?? '—'}, ${t.latitude ?? '—'}`) : ''}
        ${kv('权属/管养单位', t.ownerUnit || '—')}
        ${kv('养护责任人', t.custodian ? `${t.custodian}${t.custodianPhone ? '（' + t.custodianPhone + '）' : ''}` : '—')}
        ${t.remark ? kv('备注', t.remark, true) : ''}
      </div>

      <div class="print-only" id="print-summary"></div>
    </div>

    <div class="card no-print" id="card-exams">
      <div class="row" style="margin-bottom:10px">
        <h2 style="margin:0">体检结论 <span class="sub">历次"树体检查"记录</span></h2>
        <div class="spacer"></div>
        <button class="btn sm" id="btn-exam">＋ 新增体检</button>
      </div>
      ${renderExamList(t, constants)}
    </div>

    <div class="card no-print" id="card-measures">
      <div class="row" style="margin-bottom:10px">
        <h2 style="margin:0">复壮措施 <span class="sub">施工内容与完成情况</span></h2>
        <div class="spacer"></div>
        <button class="btn sm" id="btn-measure">＋ 登记措施</button>
      </div>
      ${renderMeasureList(t, constants)}
    </div>

    <div class="card no-print" id="card-followup">${renderTrackingBlock(t, constants)}</div>`;

  // 打印用汇总（屏幕隐藏）
  const pSum = document.getElementById('print-summary');
  if (pSum) pSum.innerHTML = buildPrintSummary(t, constants);

  // ---- 事件绑定 ----
  document.getElementById('btn-edit').addEventListener('click', () => {
    openFormModal({
      title: `编辑档案 · ${t.code}`,
      fields: treeFields(constants, t),
      submitText: '保存修改',
      wide: true,
      onSubmit: async (payload, close) => {
        await withToast(api(`/api/trees/${t.id}`, { method: 'PATCH', body: payload }), '已保存');
        close();
        renderDetail(t.id);
      },
    });
  });

  document.getElementById('btn-print').addEventListener('click', () => window.print());

  document.getElementById('btn-exam').addEventListener('click', () => {
    openFormModal({
      title: '新增体检结论',
      fields: examFields(constants, constants.today),
      wide: true,
      onSubmit: async (payload, close) => {
        await withToast(api(`/api/trees/${t.id}/exams`, { method: 'POST', body: payload }), '体检结论已记录');
        close();
        renderDetail(t.id);
      },
    });
  });

  document.getElementById('btn-measure').addEventListener('click', () => {
    openFormModal({
      title: '登记复壮措施',
      fields: measureFields(constants, {}, { today: constants.today }),
      wide: true,
      onSubmit: async (payload, close) => {
        if (payload.status === 'completed' && !payload.actualEnd) throw new Error('状态为"已完成"时，必须填写实际完成日期');
        await withToast(api(`/api/trees/${t.id}/measures`, { method: 'POST', body: payload }), '复壮措施已登记');
        close();
        renderDetail(t.id);
      },
    });
  });

  // 措施行内"编辑/完成"按钮
  document.querySelectorAll('[data-measure-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = t.measures.find((x) => x.id === btn.getAttribute('data-measure-edit'));
      openFormModal({
        title: '编辑复壮措施',
        fields: measureFields(constants, m, { today: constants.today }),
        wide: true,
        onSubmit: async (payload, close) => {
          if (payload.status === 'completed' && !payload.actualEnd) throw new Error('状态为"已完成"时，必须填写实际完成日期');
          await withToast(api(`/api/measures/${m.id}`, { method: 'PATCH', body: payload }), '措施已更新');
          close();
          renderDetail(t.id);
        },
      });
    });
  });

  // 启动两年跟踪
  const btnStart = document.getElementById('btn-start-followup');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      const undone = t.measures.filter((m) => m.status !== 'completed');
      const missingDate = t.measures.filter((m) => m.status === 'completed' && !m.actualEnd);
      if (undone.length || missingDate.length) return;
      confirmModal(
        `将以最后一项措施实际完成日为基线，自动生成第 3/6/9/12/18/24 月共 6 个跟踪节点。基线日期由完成日自动确定。`,
        '启动两年跟踪',
        async (close) => {
          await withToast(api(`/api/trees/${t.id}/followup/start`, { method: 'POST' }), '两年跟踪已启动');
          close();
          renderDetail(t.id);
        }
      );
    });
  }

  // 填报节点 / 临时随访
  document.querySelectorAll('[data-node-fill]').forEach((btn) => {
    btn.addEventListener('click', () => openFollowupModal(t, constants, Number(btn.getAttribute('data-node-fill'))));
  });
  const btnAdhoc = document.getElementById('btn-adhoc');
  if (btnAdhoc) btnAdhoc.addEventListener('click', () => openFollowupModal(t, constants, null));

  // 修改已填记录
  document.querySelectorAll('[data-record-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = t.followups.find((x) => x.id === btn.getAttribute('data-record-edit'));
      const month = rec.month;
      openFormModal({
        title: month ? `修改第 ${month} 月跟踪记录` : '修改临时随访记录',
        fields: followupFields(constants, { month, baselineDate: tr.baselineDate, today: rec.followupDate }),
        wide: true,
        onSubmit: async (payload, close) => {
          const body = normalizeFollowupPayload(payload, month);
          await withToast(api(`/api/followup-records/${rec.id}`, { method: 'PATCH', body }), '跟踪记录已更新');
          close();
          renderDetail(t.id);
        },
      });
    });
  });

  // 延长观察
  const btnExtend = document.getElementById('btn-extend');
  if (btnExtend)
    btnExtend.addEventListener('click', () =>
      confirmModal('延长观察将加挂第 30、36 月两个节点（仅可申请一次）。确定延长吗？', '延长至 36 月', async (close) => {
        await withToast(api(`/api/trackings/${tr.id}/extend`, { method: 'POST' }), '已延长至 36 月');
        close();
        renderDetail(t.id);
      })
    );

  // 结案
  const btnFinal = document.getElementById('btn-finalize');
  if (btnFinal)
    btnFinal.addEventListener('click', () => {
      openFormModal({
        title: '两年跟踪结案评定',
        fields: [
          {
            name: 'result',
            label: '复壮结果评定',
            type: 'radio',
            required: true,
            options: [
              { value: 'success', label: '复壮成功（两年存活，生长势恢复）' },
              { value: 'failed', label: '复壮失败（树体死亡/未恢复）' },
            ],
            defaultValue: 'success',
          },
          { name: 'note', label: '结案说明', type: 'textarea', span: 2, placeholder: '两年跟踪总体评价、遗留养护要求…' },
        ],
        submitText: '提交结案',
        onSubmit: async (payload, close) => {
          await withToast(api(`/api/trackings/${tr.id}/finalize`, { method: 'POST', body: payload }), '已结案');
          close();
          renderDetail(t.id);
        },
      });
    });
}

function kv(k, v, wide) {
  return `<div class="kv ${wide ? 'full' : ''}"><span class="k">${C.esc(k)}</span><span class="v">${C.esc(v)}</span></div>`;
}

function renderExamList(t, constants) {
  if (!t.exams.length) return '<div class="empty" style="padding:24px">尚无体检记录，点击右上角"新增体检"。</div>';
  return t.exams
    .map((e) => {
      const issues = C.labels(constants.issueTypes, e.issues);
      return `
      <div class="timeline-item ${e.vigor === 'dead' ? 'dead' : ''}" style="margin-left:4px">
        <div class="row">
          <span class="t-date">${C.fmtDate(e.examDate)}</span>
          <span class="badge badge-${e.vigor}">${C.label(constants.vigors, e.vigor)}</span>
          <span class="muted small">${C.esc(e.examiner || '')} ${e.organization ? '· ' + C.esc(e.organization) : ''}</span>
        </div>
        ${issues.length ? `<div class="chips" style="margin:6px 0">${issues.map((i) => `<span class="chip">${C.esc(i)}</span>`).join('')}</div>` : ''}
        ${e.diagnosis ? `<div>${C.esc(e.diagnosis)}</div>` : ''}
      </div>`;
    })
    .join('');
}

function renderMeasureList(t, constants) {
  if (!t.measures.length)
    return '<div class="empty" style="padding:24px">尚无复壮措施。体检结论为衰弱/濒危时，应据此登记复壮措施。</div>';
  return t.measures
    .map(
      (m) => `
    <div style="border:1px solid var(--gray-200);border-radius:8px;padding:12px 14px;margin-bottom:10px">
      <div class="row">
        <span class="badge badge-${m.status}">${C.label(constants.measureStatuses, m.status)}</span>
        <strong>${C.fmtDate(m.plannedStart)} ~ ${C.fmtDate(m.plannedEnd)}</strong>
        ${m.actualEnd ? `<span class="muted small">实际完成 ${C.fmtDate(m.actualEnd)}</span>` : ''}
        <div class="spacer"></div>
        <span class="muted small">${m.organization ? C.esc(m.organization) + '　' : ''}${C.yuan(m.costYuan)}</span>
        <button class="btn ghost sm" data-measure-edit="${m.id}">编辑</button>
      </div>
      <div class="chips" style="margin:8px 0 4px">
        ${C.labels(constants.measureTypes, m.types).map((x) => `<span class="chip">${C.esc(x)}</span>`).join('')}
      </div>
      ${m.detail ? `<div class="small">${C.esc(m.detail)}</div>` : ''}
      ${m.remark ? `<div class="muted small">备注：${C.esc(m.remark)}</div>` : ''}
    </div>`
    )
    .join('');
}

function renderTrackingBlock(t, constants) {
  const tr = t.tracking;

  if (!tr) {
    const ms = t.measures;
    const undone = ms.filter((m) => m.status !== 'completed');
    const missingDate = ms.filter((m) => m.status === 'completed' && !m.actualEnd);
    return `
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">两年存活跟踪</h2>
        <div class="spacer"></div>
      </div>
      ${
        ms.length === 0
          ? '<div class="banner info">登记复壮措施并全部完成后，方可启动两年跟踪。</div>'
          : undone.length || missingDate.length
            ? `<div class="banner warn">尚有 ${undone.length} 项措施未完成${missingDate.length ? `，${missingDate.length} 项已完成但未填实际完成日期` : ''}；全部完成后才能启动两年跟踪。</div>`
            : `<div class="banner success">全部复壮措施已完成，可以启动两年跟踪，系统将自动排定 3/6/9/12/18/24 月节点。</div>
               <div class="row"><div class="spacer"></div><button class="btn" id="btn-start-followup">启动两年跟踪</button></div>`
      }`;
  }

  const closed = tr.finalResult;
  return `
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0">两年存活跟踪 <span class="sub">基线（复壮完成日）${C.fmtDate(tr.baselineDate)}${tr.extended ? ' · 已延长至 36 月' : ''}</span></h2>
      <div class="spacer"></div>
      ${closed ? '' : '<button class="btn ghost sm" id="btn-adhoc">＋ 临时随访</button>'}
    </div>

    ${
      closed === 'success'
        ? `<div class="banner success">✅ 已结案：<strong>复壮成功</strong>${tr.finalizedAt ? `（${C.fmtDate(tr.finalizedAt.slice(0, 10))}）` : ''}。${tr.finalNote ? C.esc(tr.finalNote) : ''}</div>`
        : closed === 'failed'
          ? `<div class="banner failed">☠ 已结案：<strong>复壮失败（跟踪期内死亡）</strong>${tr.finalizedAt ? `（${C.fmtDate(tr.finalizedAt.slice(0, 10))}）` : ''}。${tr.finalNote ? C.esc(tr.finalNote) : ''}</div>`
          : ''
    }

    <div class="node-strip">
      ${tr.nodes
        .map((n) => {
          const stText =
            n.status === 'done'
              ? `<span class="badge badge-done">已填报</span>`
              : n.status === 'overdue'
                ? `<span class="badge badge-overdue">逾期${n.overdueDays}天</span>`
                : `<span class="badge badge-pending">待填报</span>`;
          return `<div class="node ${n.status}">
            <div class="mo">第 ${n.month} 月</div>
            <div class="due">应于 ${n.dueDate}</div>
            <div class="st">${stText}</div>
            ${n.status === 'done' ? `<div class="small" style="margin-top:4px"><span class="badge badge-${n.record.vigor}">${C.label(constants.vigors, n.record.vigor)}</span></div>` : ''}
            ${closed ? '' : `<button class="btn sm ${n.status === 'done' ? 'ghost' : ''}" style="margin-top:6px" data-node-fill="${n.month}">${n.status === 'done' ? '修改' : '填报'}</button>`}
          </div>`;
        })
        .join('')}
    </div>

    <h2 style="font-size:14px;margin:16px 0 8px">跟踪记录（含临时随访）</h2>
    ${renderFollowupRecords(t, constants, closed)}

    ${
      closed
        ? ''
        : `<div class="row" style="margin-top:14px">
             <div class="spacer"></div>
             ${tr.extended ? '' : '<button class="btn ghost" id="btn-extend">延长观察（加挂30/36月）</button>'}
             <button class="btn secondary" id="btn-finalize">结案评定</button>
           </div>
           <p class="muted small" style="margin-bottom:0">提示：任一节点填报"死亡"，系统将自动按复壮失败结案；填报全部计划节点且均存活后，可评定成功。</p>`
    }`;
}

function renderFollowupRecords(t, constants, closed) {
  const records = [
    ...tr2(t).nodes.filter((n) => n.record).map((n) => ({ ...n.record, _month: n.month })),
    ...tr2(t).adhocRecords.map((r) => ({ ...r, _month: null })),
  ].sort((a, b) => b.followupDate.localeCompare(a.followupDate));

  if (!records.length) return '<div class="muted small">尚无跟踪记录。点击下方对应节点填报。</div>';

  return records
    .map((r) => {
      const issues = C.labels(constants.issueTypes, r.newIssues);
      return `
      <div class="timeline-item ${!r.alive || r.vigor === 'dead' ? 'dead' : ''}">
        <div class="row">
          <span class="t-date">${C.fmtDate(r.followupDate)}</span>
          ${r._month ? `<span class="badge badge-tracking">第 ${r._month} 月</span>` : '<span class="chip">临时随访</span>'}
          ${r.alive ? '<span class="badge badge-done">存活</span>' : '<span class="badge badge-dead">死亡</span>'}
          <span class="badge badge-${r.vigor}">${C.label(constants.vigors, r.vigor)}</span>
          <span class="muted small">${C.esc(r.observer || '')}</span>
          <div class="spacer"></div>
          ${closed ? '' : `<button class="btn ghost sm" data-record-edit="${r.id}">修改</button>`}
        </div>
        ${issues.length ? `<div class="chips" style="margin:6px 0">${issues.map((i) => `<span class="chip">${C.esc(i)}</span>`).join('')}</div>` : ''}
        ${r.newMeasures ? `<div>${C.esc(r.newMeasures)}</div>` : ''}
        ${r.remark ? `<div class="muted small">${C.esc(r.remark)}</div>` : ''}
      </div>`;
    })
    .join('');
}

// 上面模板里引用跟踪对象的小助手
function tr2(t) {
  return t.tracking || { nodes: [], adhocRecords: [] };
}

// 打印版：体检 / 措施 / 跟踪 三张紧凑表
function buildPrintSummary(t, constants) {
  const examRows = t.exams
    .map(
      (e) =>
        `<tr><td>${C.fmtDate(e.examDate)}</td><td>${C.label(constants.vigors, e.vigor)}</td><td>${C.esc(C.labels(constants.issueTypes, e.issues).join('、'))}</td><td>${C.esc(e.diagnosis)}</td><td>${C.esc(e.organization || e.examiner)}</td></tr>`
    )
    .join('');
  const measureRows = t.measures
    .map(
      (m) =>
        `<tr><td>${C.esc(C.labels(constants.measureTypes, m.types).join('、'))}</td><td>${C.fmtDate(m.plannedStart)}~${C.fmtDate(m.plannedEnd)}</td><td>${C.fmtDate(m.actualEnd)}</td><td>${C.label(constants.measureStatuses, m.status)}</td><td>${C.esc(m.organization)}</td></tr>`
    )
    .join('');
  const tr = t.tracking;
  const followRows = tr
    ? tr.nodes
        .map((n) => {
          const r = n.record;
          return `<tr><td>第${n.month}月</td><td>${n.dueDate}</td><td>${r ? C.fmtDate(r.followupDate) : '未填报'}</td><td>${r ? (r.alive ? '存活' : '死亡') : '—'}</td><td>${r ? C.label(constants.vigors, r.vigor) : '—'}</td><td>${r ? C.esc(r.newMeasures) : ''}</td></tr>`;
        })
        .join('')
    : '';
  return `
  <h2 style="font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:4px">一、体检结论</h2>
  <table class="print-table"><thead><tr><th>日期</th><th>生长势</th><th>问题项</th><th>诊断结论</th><th>体检单位/人</th></tr></thead><tbody>${examRows || '<tr><td colspan="5">无</td></tr>'}</tbody></table>
  <h2 style="font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:4px">二、复壮措施</h2>
  <table class="print-table"><thead><tr><th>措施</th><th>计划工期</th><th>实际完成</th><th>状态</th><th>施工单位</th></tr></thead><tbody>${measureRows || '<tr><td colspan="5">无</td></tr>'}</tbody></table>
  <h2 style="font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:4px">三、两年存活跟踪${tr ? `（基线日 ${C.fmtDate(tr.baselineDate)}${tr.finalResult ? `，结案：${tr.finalResult === 'success' ? '复壮成功' : '复壮失败'}` : '，进行中'}）` : '（未启动）'}</h2>
  ${
    followRows
      ? `<table class="print-table"><thead><tr><th>节点</th><th>应到日期</th><th>填报日期</th><th>存活</th><th>生长势</th><th>现场处置/建议</th></tr></thead><tbody>${followRows}</tbody></table>`
      : '<div>—</div>'
  }
  ${tr?.finalNote ? `<p style="margin-top:8px"><strong>结案说明：</strong>${C.esc(tr.finalNote)}</p>` : ''}
  <p style="margin-top:24px">养护责任人签字：____________　　技术负责人签字：____________　　日期：____________</p>`;
}

function normalizeFollowupPayload(payload, month) {
  return {
    month,
    followupDate: payload.followupDate,
    alive: payload.alive !== 'false',
    vigor: payload.vigor,
    newIssues: payload.newIssues || [],
    newMeasures: payload.newMeasures || '',
    observer: payload.observer || '',
    remark: payload.remark || '',
  };
}

function openFollowupModal(t, constants, month) {
  const tr = t.tracking;
  // 已填过的节点直接进入修改
  if (month) {
    const existing = tr.nodes.find((n) => n.month === month)?.record;
    if (existing) {
      openFormModal({
        title: `修改第 ${month} 月跟踪记录`,
        fields: followupFields(constants, { month, baselineDate: tr.baselineDate, today: existing.followupDate }),
        wide: true,
        onSubmit: async (payload, close) => {
          const body = normalizeFollowupPayload(payload, month);
          await withToast(api(`/api/followup-records/${existing.id}`, { method: 'PATCH', body }), '跟踪记录已更新');
          close();
          renderDetail(t.id);
        },
      });
      return;
    }
  }
  openFormModal({
    title: month ? `填报第 ${month} 月跟踪` : '临时随访记录',
    fields: followupFields(constants, { month, baselineDate: tr.baselineDate, today: constants.today }),
    wide: true,
    onSubmit: async (payload, close) => {
      const body = normalizeFollowupPayload(payload, month);
      await withToast(api(`/api/trackings/${tr.id}/records`, { method: 'POST', body: payloadToServer(body) }), '跟踪记录已保存');
      close();
      renderDetail(t.id);
    },
  });
}

// 新增时 month=null 需保留 null（FormData 会变成字符串 "null"，这里已在 normalize 中处理）
function payloadToServer(body) {
  return { ...body, month: body.month === null ? null : body.month };
}

// ---------------------------------------------------------------- 路由

const routes = [
  { re: /^#\/dashboard$/, render: renderDashboard },
  { re: /^#\/trees(?:\?.*)?$/, render: renderListPage },
  { re: /^#\/trees\/([^/?]+)$/, render: (m) => renderDetail(m[1]) },
];

function setActiveNav(route) {
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

async function router() {
  const hash = location.hash || '#/dashboard';
  let match;
  try {
    if ((match = routes[0].re.exec(hash))) {
      setActiveNav('dashboard');
      await renderDashboard();
    } else if ((match = routes[1].re.exec(hash))) {
      setActiveNav('trees');
      await renderListPage();
    } else if ((match = routes[2].re.exec(hash))) {
      setActiveNav('trees');
      await renderDetail(match[1]);
    } else {
      location.hash = '#/dashboard';
      return;
    }
    window.scrollTo(0, 0);
  } catch (e) {
    $app.innerHTML = `<div class="card"><div class="empty"><span class="icon">⚠️</span>${C.esc(e.message)}<br/><br/><a class="btn" href="#/dashboard">返回仪表盘</a></div></div>`;
  }
}

window.addEventListener('hashchange', router);
router();
