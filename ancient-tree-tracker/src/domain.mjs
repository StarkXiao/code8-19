// 核心业务领域：枚举、校验、状态推导、跟踪计划生成 —— 纯函数，不碰文件系统，便于测试。
// 规则来源：《古树名木复壮技术规程》通用做法 + 本系统"两年存活跟踪"的业务约定。

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------- 枚举

// 古树等级（按《城市古树名木保护管理办法》常用分级）
export const TREE_GRADES = [
  { value: 'national_1', label: '国家一级古树（500年以上）' },
  { value: 'national_2', label: '国家二级古树（300–499年）' },
  { value: 'national_3', label: '国家三级古树（100–299年）' },
  { value: 'famous', label: '名木（历史/纪念意义）' },
];

// 生长势等级
export const VIGORS = [
  { value: 'vigorous', label: '旺盛' },
  { value: 'normal', label: '正常' },
  { value: 'weak', label: '衰弱' },
  { value: 'endangered', label: '濒危' },
  { value: 'dead', label: '死亡' },
];

// 体检问题项（多选）
export const ISSUE_TYPES = [
  { value: 'cavity', label: '树干空洞/腐朽' },
  { value: 'pest', label: '病虫害' },
  { value: 'root_soil', label: '根系与土壤问题（板结/硬化/透气差）' },
  { value: 'canopy', label: '树冠枯枝偏冠' },
  { value: 'trunk_crack', label: '树干开裂/机械损伤' },
  { value: 'lean', label: '树体倾斜' },
  { value: 'lightning', label: '雷击损伤' },
  { value: 'other', label: '其他' },
];

// 复壮措施类型（多选）
export const MEASURE_TYPES = [
  { value: 'pruning', label: '修剪整形/清腐' },
  { value: 'cavity_repair', label: '树洞修补封堵' },
  { value: 'support', label: '树体支撑加固' },
  { value: 'pest_control', label: '病虫害防治' },
  { value: 'soil_amendment', label: '土壤改良/打孔透气/换土' },
  { value: 'fertilizing', label: '科学施肥（复壮基质）' },
  { value: 'root_irrigation', label: '根系灌溉/排水' },
  { value: 'root_promotion', label: '促根/复壮沟' },
  { value: 'protection', label: '防护设施（围栏/避雷/防撞）' },
  { value: 'other', label: '其他' },
];

export const MEASURE_STATUSES = [
  { value: 'planned', label: '待实施' },
  { value: 'in_progress', label: '实施中' },
  { value: 'completed', label: '已完成' },
];

export const FOLLOWUP_MONTHS = [3, 6, 9, 12, 18, 24]; // 两年跟踪节点
export const EXTENSION_MONTHS = [30, 36]; // 复壮成功但仍需延长观察时的节点（最多一次，延至36月）

// 业务错误（携带 HTTP 状态码）
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- 日期工具

export function todayStr(now = new Date()) {
  return toISODate(now);
}

export function toISODate(d) {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d ?? '').slice(0, 10);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidISODate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toISODate(d).slice(0, 10) === s.slice(0, 10);
}

// 基线日 + n 个月（对日，月底溢出取该月最后一天）
export function addMonthsISO(baseISO, months) {
  const [y, m, d] = baseISO.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(aISO, bISO) {
  const a = new Date(`${aISO}T00:00:00Z`).getTime();
  const b = new Date(`${bISO}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------- 校验

const tr = (v) => (typeof v === 'string' ? v.trim() : v);

function require_(cond, status, code, msg) {
  if (!cond) throw new ApiError(status, code, msg);
}

export function validateTree(input, { partial = false } = {}) {
  const out = {};
  const get = (k) => tr(input?.[k]);

  if (!partial || input.species !== undefined) {
    require_(get('species'), 400, 'VALIDATION', '树种不能为空');
    out.species = get('species');
  }
  if (!partial || input.latinName !== undefined) out.latinName = get('latinName') || '';
  if (!partial || input.grade !== undefined) {
    require_(TREE_GRADES.some((g) => g.value === get('grade')), 400, 'VALIDATION', '古树等级不合法');
    out.grade = get('grade');
  }
  if (!partial || input.estimatedAge !== undefined) {
    const n = Number(get('estimatedAge'));
    require_(Number.isFinite(n) && n >= 0 && n <= 9999, 400, 'VALIDATION', '树龄需为 0–9999 的数字');
    out.estimatedAge = Math.round(n);
  }
  if (!partial || input.location !== undefined) {
    require_(get('location'), 400, 'VALIDATION', '生长位置不能为空');
    out.location = get('location');
  }
  if (input?.longitude !== undefined && input.longitude !== '' && input.longitude !== null) {
    const n = Number(input.longitude);
    require_(Number.isFinite(n) && n >= -180 && n <= 180, 400, 'VALIDATION', '经度需在 -180~180 之间');
    out.longitude = n;
  }
  if (input?.latitude !== undefined && input.latitude !== '' && input.latitude !== null) {
    const n = Number(input.latitude);
    require_(Number.isFinite(n) && n >= -90 && n <= 90, 400, 'VALIDATION', '纬度需在 -90~90 之间');
    out.latitude = n;
  }
  if (input?.heightM !== undefined && input.heightM !== '' && input.heightM !== null) {
    const n = Number(input.heightM);
    require_(Number.isFinite(n) && n > 0 && n <= 300, 400, 'VALIDATION', '树高需为 0~300 米');
    out.heightM = Math.round(n * 10) / 10;
  }
  if (input?.dbhCm !== undefined && input.dbhCm !== '' && input.dbhCm !== null) {
    const n = Number(input.dbhCm);
    require_(Number.isFinite(n) && n > 0 && n <= 1000, 400, 'VALIDATION', '胸径需为 0~1000 厘米');
    out.dbhCm = Math.round(n * 10) / 10;
  }
  if (input?.crownWidthM !== undefined && input.crownWidthM !== '' && input.crownWidthM !== null) {
    const n = Number(input.crownWidthM);
    require_(Number.isFinite(n) && n > 0 && n <= 200, 400, 'VALIDATION', '冠幅需为 0~200 米');
    out.crownWidthM = Math.round(n * 10) / 10;
  }
  if (!partial || input.ownerUnit !== undefined) out.ownerUnit = get('ownerUnit') || '';
  if (!partial || input.custodian !== undefined) out.custodian = get('custodian') || '';
  if (!partial || input.custodianPhone !== undefined) out.custodianPhone = get('custodianPhone') || '';
  if (!partial || input.remark !== undefined) out.remark = get('remark') || '';
  return out;
}

function validateEnumList(list, allowed, field) {
  const arr = Array.isArray(list) ? [...new Set(list.map((x) => tr(x)).filter(Boolean))] : [];
  require_(arr.every((v) => allowed.some((a) => a.value === v)), 400, 'VALIDATION', `${field}包含不合法取值`);
  return arr;
}

export function validateExam(input) {
  const date = toISODate(input?.examDate);
  require_(isValidISODate(date), 400, 'VALIDATION', '体检日期不合法');
  const vigor = tr(input?.vigor);
  require_(VIGORS.some((v) => v.value === vigor), 400, 'VALIDATION', '生长势等级不合法');
  return {
    examDate: date,
    vigor,
    issues: validateEnumList(input?.issues, ISSUE_TYPES, '体检问题项'),
    diagnosis: tr(input?.diagnosis) || '',
    examiner: tr(input?.examiner) || '',
    organization: tr(input?.organization) || '',
  };
}

export function validateMeasure(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.types !== undefined) {
    out.types = validateEnumList(input?.types, MEASURE_TYPES, '复壮措施类型');
    require_(out.types.length > 0, 400, 'VALIDATION', '至少选择一项复壮措施');
  }
  if (!partial || input.detail !== undefined) out.detail = tr(input?.detail) || '';
  if (!partial || input.plannedStart !== undefined) {
    const v = toISODate(input?.plannedStart);
    require_(isValidISODate(v), 400, 'VALIDATION', '计划开始日期不合法');
    out.plannedStart = v;
  }
  if (!partial || input.plannedEnd !== undefined) {
    const v = toISODate(input?.plannedEnd);
    require_(isValidISODate(v), 400, 'VALIDATION', '计划完成日期不合法');
    out.plannedEnd = v;
  }
  require_(
    !(out.plannedStart && out.plannedEnd) || daysBetween(out.plannedStart, out.plannedEnd) >= 0,
    400,
    'VALIDATION',
    '计划完成日期不能早于开始日期'
  );
  if (!partial || input.actualEnd !== undefined) {
    const raw = input?.actualEnd;
    if (raw === '' || raw === null || raw === undefined) {
      out.actualEnd = null;
    } else {
      const v = toISODate(raw);
      require_(isValidISODate(v), 400, 'VALIDATION', '实际完成日期不合法');
      out.actualEnd = v;
    }
  }
  if (!partial || input.status !== undefined) {
    const s = tr(input?.status);
    require_(MEASURE_STATUSES.some((x) => x.value === s), 400, 'VALIDATION', '措施状态不合法');
    out.status = s;
  }
  if (!partial || input.organization !== undefined) out.organization = tr(input?.organization) || '';
  if (!partial || input.costYuan !== undefined) {
    const raw = input?.costYuan;
    if (raw === '' || raw === null || raw === undefined) out.costYuan = null;
    else {
      const n = Number(raw);
      require_(Number.isFinite(n) && n >= 0, 400, 'VALIDATION', '费用需为非负数字');
      out.costYuan = Math.round(n * 100) / 100;
    }
  }
  if (!partial || input.remark !== undefined) out.remark = tr(input?.remark) || '';

  // 标记完成时必须给出实际完成日期
  if (out.status === 'completed' && out.actualEnd === undefined) out.actualEnd = null;
  return out;
}

export function validateFollowup(input) {
  // 计划节点（month 为 3/6/.../24）或临时随访（month=null）
  let month = null;
  if (input?.month !== null && input?.month !== undefined && input?.month !== '') {
    month = Number(input.month);
    require_(
      Number.isInteger(month) && month >= 1 && month <= 36,
      400,
      'VALIDATION',
      '跟踪节点（月）需为 1–36 的整数'
    );
  }
  const date = toISODate(input?.followupDate);
  require_(isValidISODate(date), 400, 'VALIDATION', '跟踪日期不合法');
  const vigor = tr(input?.vigor);
  require_(VIGORS.some((v) => v.value === vigor), 400, 'VALIDATION', '生长势等级不合法');
  return {
    month,
    followupDate: date,
    alive: input?.alive !== false,
    vigor,
    newIssues: validateEnumList(input?.newIssues, ISSUE_TYPES, '新发现问题'),
    newMeasures: tr(input?.newMeasures) || '',
    observer: tr(input?.observer) || '',
    remark: tr(input?.remark) || '',
  };
}

// ---------------------------------------------------------------- 档案操作

/** 生成下一个档案编号：GS-YYYY-NNN（按年份自增） */
export function nextTreeCode(db, dateISO = todayStr()) {
  const year = dateISO.slice(0, 4);
  const prefix = `GS-${year}-`;
  let max = 0;
  for (const t of Object.values(db.trees || {})) {
    if (t.code?.startsWith(prefix)) {
      const n = Number(t.code.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function createTree(db, input, now = new Date()) {
  const fields = validateTree(input);
  const id = randomUUID();
  const tree = {
    id,
    code: nextTreeCode(db, toISODate(now)),
    ...fields,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.trees[id] = tree;
  return tree;
}

export function updateTree(db, id, input, now = new Date()) {
  const tree = db.trees[id];
  require_(tree, 404, 'NOT_FOUND', '档案不存在');
  const fields = validateTree(input, { partial: true });
  Object.assign(tree, fields, { updatedAt: now.toISOString() });
  return tree;
}

export function createExam(db, treeId, input, now = new Date()) {
  const tree = db.trees[treeId];
  require_(tree, 404, 'NOT_FOUND', '档案不存在');
  const data = validateExam(input);
  const exam = { id: randomUUID(), treeId, createdAt: now.toISOString(), ...data };
  db.exams[exam.id] = exam;
  tree.updatedAt = now.toISOString();
  return exam;
}

export function createMeasure(db, treeId, input, now = new Date()) {
  const tree = db.trees[treeId];
  require_(tree, 404, 'NOT_FOUND', '档案不存在');
  const data = validateMeasure(input);
  require_(
    data.status !== 'completed' || (data.actualEnd && isValidISODate(data.actualEnd)),
    400,
    'VALIDATION',
    '措施标记为已完成时必须填写实际完成日期'
  );
  const measure = { id: randomUUID(), treeId, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...data };
  db.measures[measure.id] = measure;
  tree.updatedAt = now.toISOString();
  return measure;
}

export function updateMeasure(db, id, input, now = new Date()) {
  const measure = db.measures[id];
  require_(measure, 404, 'NOT_FOUND', '复壮措施不存在');
  const merged = { ...measure, ...input };
  const data = validateMeasure(merged, { partial: false });
  Object.assign(measure, data, { updatedAt: now.toISOString() });
  return measure;
}

/**
 * 以最后一条"已完成"措施的实际完成日作为复壮基线，启动两年跟踪。
 * 自动生成 3/6/9/12/18/24 月六个计划节点。
 */
export function startFollowup(db, treeId, now = new Date()) {
  const tree = db.trees[treeId];
  require_(tree, 404, 'NOT_FOUND', '档案不存在');
  const existing = Object.values(db.trackings || {}).find((t) => t.treeId === treeId);
  require_(!existing, 409, 'CONFLICT', '该树已启动过两年跟踪，不能重复启动');

  const ms = Object.values(db.measures || {}).filter((m) => m.treeId === treeId);
  require_(ms.length > 0, 400, 'VALIDATION', '尚未登记任何复壮措施，无法启动跟踪');
  require_(
    ms.every((m) => m.status === 'completed' && m.actualEnd),
    400,
    'VALIDATION',
    '全部复壮措施完成（并填写实际完成日期）后才能启动两年跟踪'
  );
  const baselineDate = ms.map((m) => m.actualEnd).sort().at(-1);

  const tracking = {
    id: randomUUID(),
    treeId,
    baselineDate,
    months: FOLLOWUP_MONTHS.slice(),
    extended: false,
    finalResult: null, // null | 'success' | 'failed'
    finalNote: '',
    finalizedAt: null,
    createdAt: now.toISOString(),
  };
  db.trackings[tracking.id] = tracking;
  tree.updatedAt = now.toISOString();
  return tracking;
}

export function addFollowupRecord(db, trackingId, input, now = new Date()) {
  const tracking = db.trackings[trackingId];
  require_(tracking, 404, 'NOT_FOUND', '跟踪计划不存在');
  require_(!tracking.finalResult, 409, 'CONFLICT', '该跟踪已结案，不能再填报');
  const data = validateFollowup(input);

  if (data.month !== null) {
    require_(tracking.months.includes(data.month), 400, 'VALIDATION', '该跟踪节点不在计划内');
    const dup = Object.values(db.followups || {}).find(
      (f) => f.trackingId === trackingId && f.month === data.month
    );
    require_(!dup, 409, 'CONFLICT', `${data.month} 月节点已填报，请直接修改原记录`);
  }
  require_(
    daysBetween(tracking.baselineDate, data.followupDate) >= 0,
    400,
    'VALIDATION',
    '跟踪日期不能早于复壮基线日期'
  );

  const rec = { id: randomUUID(), trackingId, createdAt: now.toISOString(), ...data };
  db.followups[rec.id] = rec;

  // 随访确认死亡 → 自动结案（复壮失败）
  if (!data.alive || data.vigor === 'dead') {
    tracking.finalResult = 'failed';
    tracking.finalNote = `第 ${data.month ?? '临时'} 月跟踪确认死亡（${data.followupDate}），自动结案。`;
    tracking.finalizedAt = now.toISOString();
  }
  return rec;
}

export function updateFollowupRecord(db, id, input, now = new Date()) {
  const rec = db.followups[id];
  require_(rec, 404, 'NOT_FOUND', '跟踪记录不存在');
  const tracking = db.trackings[rec.trackingId];
  require_(!tracking.finalResult, 409, 'CONFLICT', '该跟踪已结案，记录不可修改');
  const merged = { ...rec, ...input };
  const data = validateFollowup(merged);
  Object.assign(rec, data);
  if (!data.alive || data.vigor === 'dead') {
    tracking.finalResult = 'failed';
    tracking.finalNote = `跟踪记录确认为死亡（${data.followupDate}），自动结案。`;
    tracking.finalizedAt = now.toISOString();
  }
  return rec;
}

/** 评定结案：success（24月存活，可延长观察）/ failed（人工确认死亡） */
export function finalizeTracking(db, trackingId, input, now = new Date()) {
  const tracking = db.trackings[trackingId];
  require_(tracking, 404, 'NOT_FOUND', '跟踪计划不存在');
  require_(!tracking.finalResult, 409, 'CONFLICT', '该跟踪已结案');
  const result = tr(input?.result);
  require_(['success', 'failed'].includes(result), 400, 'VALIDATION', '结案结果只能是 success 或 failed');

  const records = Object.values(db.followups || {}).filter((f) => f.trackingId === trackingId);
  const lastDead = records.some((r) => !r.alive || r.vigor === 'dead');
  require_(!lastDead, 409, 'CONFLICT', '已有跟踪记录确认死亡，该跟踪已自动评定为失败');

  if (result === 'success') {
    const missing = tracking.months.filter(
      (mo) => !records.some((r) => r.month === mo && r.alive && r.vigor !== 'dead')
    );
    require_(missing.length === 0, 400, 'VALIDATION', `以下计划节点尚无存活记录，不能评定成功：${missing.join('、')} 月`);
  }

  tracking.finalResult = result;
  tracking.finalNote = tr(input?.note) || '';
  tracking.finalizedAt = now.toISOString();
  return tracking;
}

/** 成功结案前可选延长：加挂 30/36 月节点（仅一次） */
export function extendTracking(db, trackingId, now = new Date()) {
  const tracking = db.trackings[trackingId];
  require_(tracking, 404, 'NOT_FOUND', '跟踪计划不存在');
  require_(!tracking.finalResult, 409, 'CONFLICT', '已结案的跟踪不能延长');
  require_(!tracking.extended, 409, 'CONFLICT', '延长观察只能申请一次（已延长至 36 月）');
  for (const mo of EXTENSION_MONTHS) {
    if (!tracking.months.includes(mo)) tracking.months.push(mo);
  }
  tracking.months.sort((a, b) => a - b);
  tracking.extended = true;
  return tracking;
}

// ---------------------------------------------------------------- 视图推导

/** 某跟踪的节点状态：done / overdue / pending */
export function nodeStatus(tracking, month, records, today = todayStr()) {
  const rec = records.find((r) => r.month === month);
  if (rec) return 'done';
  if (tracking.finalResult) return 'pending';
  const due = addMonthsISO(tracking.baselineDate, month);
  return daysBetween(due, today) > 0 ? 'overdue' : 'pending';
}

export function buildTrackingView(tracking, records, today = todayStr()) {
  const nodes = tracking.months.map((month) => {
    const dueDate = addMonthsISO(tracking.baselineDate, month);
    const record = records.find((r) => r.month === month) || null;
    return {
      month,
      dueDate,
      status: nodeStatus(tracking, month, records, today),
      overdueDays: !record && !tracking.finalResult ? Math.max(0, daysBetween(dueDate, today)) : 0,
      record,
    };
  });
  const adhoc = records.filter((r) => r.month === null).sort((a, b) => a.followupDate.localeCompare(b.followupDate));
  return { ...tracking, nodes, adhocRecords: adhoc };
}

/**
 * 档案业务状态（仪表盘统计口径）：
 * normal_care 正常养护 / treating 复壮中 / tracking 两年跟踪中
 * closed_success 复壮成功（已结案）/ closed_failed 复壮失败（已结案）
 */
export function deriveTreeStatus(tree, related, today = todayStr()) {
  const { exams = [], measures = [], tracking = null, trackingView = null } =
    related || {};

  if (tracking?.finalResult === 'failed') return 'closed_failed';
  if (tracking?.finalResult === 'success') return 'closed_success';

  if (tracking && trackingView) {
    if (trackingView.nodes.some((n) => n.status === 'overdue')) return 'tracking'; // 有逾期
    return 'tracking';
  }

  const latest = [...exams].sort((a, b) => b.examDate.localeCompare(a.examDate))[0];
  if (measures.length > 0 && measures.some((m) => m.status !== 'completed')) return 'treating';
  if (latest && ['weak', 'endangered'].includes(latest.vigor)) {
    return measures.length === 0 ? 'treating' : 'treating';
  }
  return 'normal_care';
}

export const TREE_STATUS_META = {
  normal_care: { label: '正常养护', color: '#52a352' },
  treating: { label: '复壮中', color: '#c87a1f' },
  tracking: { label: '两年跟踪中', color: '#2f6db3' },
  closed_success: { label: '复壮成功（已结案）', color: '#2e8b57' },
  closed_failed: { label: '复壮失败（死亡结案）', color: '#b03a3a' },
};

/** 下一待办节点（仪表盘"待办"用） */
export function nextDueNode(tracking, records, today = todayStr()) {
  if (!tracking || tracking.finalResult) return null;
  const view = buildTrackingView(tracking, records, today);
  // 逾期优先，其次最近到期
  const overdue = view.nodes.filter((n) => n.status === 'overdue').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (overdue[0]) return overdue[0];
  return view.nodes.filter((n) => n.status === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
}

/** 汇总一棵树的完整视图（详情页用） */
export function buildTreeView(db, treeId, today = todayStr()) {
  const tree = db.trees[treeId];
  if (!tree) return null;
  const exams = Object.values(db.exams || {})
    .filter((e) => e.treeId === treeId)
    .sort((a, b) => b.examDate.localeCompare(a.examDate) || b.createdAt.localeCompare(a.createdAt));
  const measures = Object.values(db.measures || {})
    .filter((m) => m.treeId === treeId)
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
  const tracking = Object.values(db.trackings || {}).find((t) => t.treeId === treeId) || null;
  const followups = tracking
    ? Object.values(db.followups || {}).filter((f) => f.trackingId === tracking.id)
    : [];
  const trackingView = tracking ? buildTrackingView(tracking, followups, today) : null;
  const status = deriveTreeStatus(tree, { exams, measures, tracking, trackingView }, today);
  return {
    ...tree,
    status,
    statusLabel: TREE_STATUS_META[status].label,
    latestExam: exams[0] || null,
    exams,
    measures,
    tracking: trackingView,
    followups,
    nextDue: nextDueNode(tracking, followups, today),
  };
}

/** 列表：概览 + 搜索/状态过滤 */
export function listTrees(db, { q = '', status = '', today = todayStr() } = {}) {
  const kw = String(q).trim().toLowerCase();
  return Object.values(db.trees || {})
    .map((t) => buildTreeView(db, t.id, today))
    .filter((v) => {
      if (status && v.status !== status) return false;
      if (!kw) return true;
      return [v.code, v.species, v.latinName, v.location, v.ownerUnit, v.custodian]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(kw));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 仪表盘统计 + 待办 */
export function buildStats(db, today = todayStr()) {
  const views = Object.values(db.trees || {}).map((t) => buildTreeView(db, t.id, today));
  const byStatus = {};
  for (const key of Object.keys(TREE_STATUS_META)) byStatus[key] = 0;
  for (const v of views) byStatus[v.status]++;

  const todos = [];
  const overdueNodes = [];
  for (const v of views) {
    if (v.nextDue) {
      todos.push({
        treeId: v.id,
        code: v.code,
        species: v.species,
        location: v.location,
        month: v.nextDue.month,
        dueDate: v.nextDue.dueDate,
        overdueDays: v.nextDue.overdueDays,
      });
      if (v.nextDue.status === 'overdue') overdueNodes.push(todos[todos.length - 1]);
    }
    // 衰弱/濒危但没有任何措施，也是待办
    if (v.latestExam && ['weak', 'endangered'].includes(v.latestExam.vigor) && v.measures.length === 0) {
      todos.push({
        treeId: v.id,
        code: v.code,
        species: v.species,
        location: v.location,
        month: null,
        dueDate: v.latestExam.examDate,
        overdueDays: 0,
        reason: `体检结论为「${VIGORS.find((x) => x.value === v.latestExam.vigor)?.label}」，待制定复壮措施`,
      });
    }
  }
  todos.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  overdueNodes.sort((a, b) => b.overdueDays - a.overdueDays);

  // 跟踪达成率
  let tracked = 0;
  let success = 0;
  let failed = 0;
  for (const t of Object.values(db.trackings || {})) {
    tracked++;
    if (t.finalResult === 'success') success++;
    if (t.finalResult === 'failed') failed++;
  }

  return {
    total: views.length,
    byStatus,
    tracked,
    success,
    failed,
    successRate: tracked ? Math.round((success / tracked) * 1000) / 10 : null,
    overdueCount: overdueNodes.length,
    todos,
  };
}
