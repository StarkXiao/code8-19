import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DB,
} from '../src/db.mjs';
import {
  ApiError,
  addMonthsISO,
  createTree,
  createExam,
  createMeasure,
  startFollowup,
  addFollowupRecord,
  updateFollowupRecord,
  finalizeTracking,
  extendTracking,
  buildTreeView,
  buildStats,
  listTrees,
} from '../src/domain.mjs';

const TODAY = '2026-09-20';
const now = (d) => new Date(`${d}T08:00:00Z`);

function validTree(over = {}) {
  return {
    species: '银杏',
    grade: 'national_1',
    estimatedAge: 500,
    location: '文庙',
    ...over,
  };
}

function expectError(fn, status, codePart) {
  assert.throws(fn, (e) => e instanceof ApiError && e.status === status && e.code.includes(codePart));
}

describe('日期工具', () => {
  test('addMonthsISO 月末溢出取当月最后一天', () => {
    assert.equal(addMonthsISO('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsISO('2024-01-31', 1), '2024-02-29'); // 闰年
    assert.equal(addMonthsISO('2026-08-20', 12), '2027-08-20');
  });
});

describe('建档与编号', () => {
  test('必填校验：缺树种/等级/树龄/位置都应拒绝', () => {
    const db = structuredClone(EMPTY_DB);
    expectError(() => createTree(db, validTree({ species: '' })), 400, 'VALIDATION');
    expectError(() => createTree(db, validTree({ grade: 'xxx' })), 400, 'VALIDATION');
    expectError(() => createTree(db, validTree({ estimatedAge: -1 })), 400, 'VALIDATION');
    expectError(() => createTree(db, validTree({ location: '' })), 400, 'VALIDATION');
  });

  test('编号按年份自增 GS-YYYY-NNN', () => {
    const db = structuredClone(EMPTY_DB);
    const t1 = createTree(db, validTree(), now('2026-03-01'));
    const t2 = createTree(db, validTree(), now('2026-11-01'));
    assert.equal(t1.code, 'GS-2026-001');
    assert.equal(t2.code, 'GS-2026-002');
    const t3 = createTree(db, validTree(), now('2027-01-01'));
    assert.equal(t3.code, 'GS-2027-001');
  });

  test('搜索支持树种/编号/位置', () => {
    const db = structuredClone(EMPTY_DB);
    createTree(db, validTree({ species: '银杏', location: '文庙' }), now(TODAY));
    createTree(db, validTree({ species: '香樟', location: '滨河公园' }), now(TODAY));
    assert.equal(listTrees(db, { q: '银杏', today: TODAY }).length, 1);
    assert.equal(listTrees(db, { q: 'gs-2026-002', today: TODAY }).length, 1);
    assert.equal(listTrees(db, { q: '不存在' }).length, 0);
  });
});

describe('体检与措施', () => {
  test('体检结论枚举与多选问题项校验', () => {
    const db = structuredClone(EMPTY_DB);
    const t = createTree(db, validTree(), now(TODAY));
    const e = createExam(
      db,
      t.id,
      { examDate: '2026-09-01', vigor: 'weak', issues: ['cavity', 'pest'], diagnosis: '空洞' },
      now(TODAY)
    );
    assert.deepEqual(e.issues, ['cavity', 'pest']);
    expectError(
      () => createExam(db, t.id, { examDate: '2026-09-01', vigor: 'bad' }),
      400,
      'VALIDATION'
    );
  });

  test('衰弱体检 + 无措施 → 复壮中', () => {
    const db = structuredClone(EMPTY_DB);
    const t = createTree(db, validTree(), now(TODAY));
    createExam(db, t.id, { examDate: '2026-09-01', vigor: 'endangered', issues: ['lean'] }, now(TODAY));
    const v = buildTreeView(db, t.id, TODAY);
    assert.equal(v.status, 'treating');
  });

  test('正常体检 → 正常养护', () => {
    const db = structuredClone(EMPTY_DB);
    const t = createTree(db, validTree(), now(TODAY));
    createExam(db, t.id, { examDate: '2026-09-01', vigor: 'normal', issues: [] }, now(TODAY));
    assert.equal(buildTreeView(db, t.id, TODAY).status, 'normal_care');
  });

  test('措施完成日期不能早于开始日期；完成态必须填实际完成日', () => {
    const db = structuredClone(EMPTY_DB);
    const t = createTree(db, validTree(), now(TODAY));
    expectError(
      () =>
        createMeasure(
          db,
          t.id,
          {
            types: ['support'],
            plannedStart: '2026-09-10',
            plannedEnd: '2026-09-01',
            status: 'planned',
          }
        ),
      400,
      'VALIDATION'
    );
    expectError(
      () =>
        createMeasure(
          db,
          t.id,
          { types: ['support'], plannedStart: '2026-09-01', plannedEnd: '2026-09-10', status: 'completed' }
        ),
      400,
      'VALIDATION'
    );
  });
});

// 搭建一个"措施全部完成"的树，返回 t
function setupCompletedTree(db, baselineDate = '2026-01-15') {
  const t = createTree(db, validTree(), now(baselineDate));
  createExam(
    db,
    t.id,
    { examDate: addMonthsISO(baselineDate, -1), vigor: 'weak', issues: ['cavity'] },
    now(baselineDate)
  );
  createMeasure(
    db,
    t.id,
    {
      types: ['cavity_repair', 'support'],
      plannedStart: addMonthsISO(baselineDate, -1),
      plannedEnd: baselineDate,
      actualEnd: baselineDate,
      status: 'completed',
      organization: '某园林公司',
    },
    now(baselineDate)
  );
  return t;
}

describe('两年跟踪', () => {
  test('启动前置：无措施或措施未全部完成则拒绝；成功后生成六个节点', () => {
    const db = structuredClone(EMPTY_DB);
    const t0 = createTree(db, validTree(), now(TODAY));
    expectError(() => startFollowup(db, t0.id), 400, 'VALIDATION');

    const t = setupCompletedTree(db);
    const tracking = startFollowup(db, t.id, now('2026-01-16'));
    assert.deepEqual(tracking.months, [3, 6, 9, 12, 18, 24]);
    assert.equal(tracking.baselineDate, '2026-01-15');
    // 不能重复启动
    expectError(() => startFollowup(db, t.id), 409, 'CONFLICT');

    const v = buildTreeView(db, t.id, TODAY);
    assert.equal(v.status, 'tracking');
    // 3月节点 2026-04-15、6月 2026-07-15 已填报前应逾期（今天 2026-09-20）
    const st3 = v.tracking.nodes.find((n) => n.month === 3);
    assert.equal(st3.status, 'overdue');
    assert.ok(st3.overdueDays > 0);
    assert.ok(v.nextDue.overdueDays > 0);
  });

  test('同一节点不能重复填报；临时随访 month=null 允许多条', () => {
    const db = structuredClone(EMPTY_DB);
    const t = setupCompletedTree(db);
    const tr = startFollowup(db, t.id);
    addFollowupRecord(
      db,
      tr.id,
      { month: 3, followupDate: '2026-04-16', alive: true, vigor: 'normal', observer: '甲' }
    );
    expectError(
      () =>
        addFollowupRecord(
          db,
          tr.id,
          { month: 3, followupDate: '2026-04-20', alive: true, vigor: 'normal' }
        ),
      409,
      'CONFLICT'
    );
    addFollowupRecord(
      db,
      tr.id,
      { month: null, followupDate: '2026-05-01', alive: true, vigor: 'normal', remark: '台风后巡检' }
    );
    addFollowupRecord(
      db,
      tr.id,
      { month: null, followupDate: '2026-05-10', alive: true, vigor: 'normal' }
    );
    const v = buildTreeView(db, t.id, TODAY);
    assert.equal(v.tracking.adhocRecords.length, 2);
    assert.equal(v.tracking.nodes.find((n) => n.month === 3).status, 'done');
  });

  test('跟踪日期不能早于复壮基线', () => {
    const db = structuredClone(EMPTY_DB);
    const t = setupCompletedTree(db);
    const tr = startFollowup(db, t.id);
    expectError(
      () => addFollowupRecord(db, tr.id, { month: 3, followupDate: '2025-12-01', alive: true, vigor: 'normal' }),
      400,
      'VALIDATION'
    );
  });

  test('随访确认死亡 → 自动失败结案，之后禁止填报与修改', () => {
    const db = structuredClone(EMPTY_DB);
    const t = setupCompletedTree(db);
    const tr = startFollowup(db, t.id);
    addFollowupRecord(db, tr.id, { month: 3, followupDate: '2026-04-15', alive: true, vigor: 'weak' });
    const dead = addFollowupRecord(
      db,
      tr.id,
      { month: 6, followupDate: '2026-07-20', alive: false, vigor: 'dead', remark: '整株枯死' }
    );
    const v = buildTreeView(db, t.id, TODAY);
    assert.equal(v.tracking.finalResult, 'failed');
    assert.equal(v.status, 'closed_failed');
    expectError(
      () => addFollowupRecord(db, tr.id, { month: 9, followupDate: '2026-10-20', alive: false, vigor: 'dead' }),
      409,
      'CONFLICT'
    );
    expectError(() => finalizeTracking(db, tr.id, { result: 'success' }), 409, 'CONFLICT');
    expectError(
      () => require_update(db, dead.id, { vigor: 'normal' }),
      409,
      'CONFLICT'
    );
  });

  function require_update(d, id, patch) {
    // 延迟引用避免循环；直接调 updateFollowupRecord
    return updateFollowupRecord(d, id, patch);
  }

  test('成功结案要求所有计划节点均有存活记录；结案后状态为成功', () => {
    const db = structuredClone(EMPTY_DB);
    const t = setupCompletedTree(db, '2024-08-20');
    const tr = startFollowup(db, t.id, now('2024-08-21'));
    // 缺节点 → 拒绝
    expectError(() => finalizeTracking(db, tr.id, { result: 'success' }), 400, 'VALIDATION');
    for (const m of [3, 6, 9, 12, 18]) {
      addFollowupRecord(db, tr.id, {
        month: m,
        followupDate: addMonthsISO('2024-08-20', m),
        alive: true,
        vigor: 'normal',
      });
    }
    // 仍缺 24 月
    expectError(() => finalizeTracking(db, tr.id, { result: 'success' }), 400, 'VALIDATION');
    addFollowupRecord(db, tr.id, {
      month: 24,
      followupDate: addMonthsISO('2024-08-20', 24),
      alive: true,
      vigor: 'vigorous',
    });
    finalizeTracking(db, tr.id, { result: 'success', note: '恢复良好' });
    const v = buildTreeView(db, t.id, TODAY);
    assert.equal(v.status, 'closed_success');
    assert.equal(v.nextDue, null);
  });

  test('延长观察仅一次：加挂 30/36 月节点，结案前不得缺节点', () => {
    const db = structuredClone(EMPTY_DB);
    const t = setupCompletedTree(db, '2024-08-20');
    const tr = startFollowup(db, t.id);
    extendTracking(db, tr.id);
    assert.deepEqual(tr.months, [3, 6, 9, 12, 18, 24, 30, 36]);
    expectError(() => extendTracking(db, tr.id), 409, 'CONFLICT');
    for (const m of [3, 6, 9, 12, 18, 24]) {
      addFollowupRecord(db, tr.id, {
        month: m,
        followupDate: addMonthsISO('2024-08-20', m),
        alive: true,
        vigor: 'normal',
      });
    }
    // 30/36 未填 → 仍不能成功结案
    expectError(() => finalizeTracking(db, tr.id, { result: 'success' }), 400, 'VALIDATION');
  });
});

describe('仪表盘', () => {
  test('状态分桶、逾期计数、复壮成功率', () => {
    const db = structuredClone(EMPTY_DB);

    // 正常养护
    const d = createTree(db, validTree({ species: '松' }), now(TODAY));
    createExam(db, d.id, { examDate: '2026-09-01', vigor: 'normal', issues: [] }, now(TODAY));

    // 跟踪中（逾期）
    const b = setupCompletedTree(db, '2026-01-15');
    startFollowup(db, b.id);

    // 失败结案
    const e = setupCompletedTree(db, '2025-09-01');
    const te = startFollowup(db, e.id);
    addFollowupRecord(db, te.id, {
      month: 3,
      followupDate: '2025-12-01',
      alive: false,
      vigor: 'dead',
    });

    const stats = buildStats(db, TODAY);
    assert.equal(stats.total, 3);
    assert.equal(stats.byStatus.normal_care, 1);
    assert.equal(stats.byStatus.tracking, 1);
    assert.equal(stats.byStatus.closed_failed, 1);
    assert.equal(stats.overdueCount, 1);
    assert.equal(stats.tracked, 2);
    assert.equal(stats.failed, 1);
    assert.equal(stats.successRate, 0);
    // 待办含逾期节点
    assert.ok(stats.todos.some((x) => x.code === b.code && x.overdueDays > 0));
  });
});
