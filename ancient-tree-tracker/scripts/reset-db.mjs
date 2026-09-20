// 写入演示数据：覆盖 正常养护 / 复壮中 / 跟踪中（含逾期）/ 复壮成功 / 复壮失败 五种状态。
// node scripts/reset-db.mjs          # 仅库为空时写入
// node scripts/reset-db.mjs --force  # 清空重写
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  EMPTY_DB,
} from '../src/db.mjs'; // EMPTY_DB 常量（JsonDB 不需要，直接写文件）
import {
  createTree,
  createExam,
  createMeasure,
  startFollowup,
  addFollowupRecord,
  finalizeTracking,
  addMonthsISO,
  todayStr,
} from '../src/domain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.resolve(ROOT, process.env.DB_FILE || 'data/db.json');
const force = process.argv.includes('--force');

function iso(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
}
function monthsAgoISO(base, n) {
  return addMonthsISO(base, -n);
}
function at(days) {
  return new Date(`${daysAgo(days)}T08:00:00Z`);
}

async function main() {
  if (existsSync(DB_FILE) && !force) {
    const raw = JSON.parse(await readFile(DB_FILE, 'utf8'));
    if (raw.trees && Object.keys(raw.trees).length > 0) {
      console.error('数据库已有档案数据。如确认要清空重写，请运行: npm run seed:force');
      process.exit(1);
    }
  }

  const db = structuredClone(EMPTY_DB);
  const today = todayStr();

  // ---- A. 复壮成功（已结案）：两年六次跟踪全部存活 ----------------
  const a = createTree(
    db,
    {
      species: '银杏',
      latinName: 'Ginkgo biloba L.',
      grade: 'national_1',
      estimatedAge: 820,
      location: '文庙大院大成殿前月台东侧',
      longitude: 118.763,
      latitude: 32.061,
      heightM: 24.5,
      dbhCm: 168,
      crownWidthM: 16,
      ownerUnit: '文庙文物管理所',
      custodian: '周守根',
      custodianPhone: '13800000001',
      remark: '南宋古银杏，市级挂牌保护。',
    },
    at(900)
  );
  createExam(
    db,
    a.id,
    {
      examDate: monthsAgoISO(today, 27),
      vigor: 'weak',
      issues: ['cavity', 'pest', 'root_soil'],
      diagnosis: '主干西侧纵向空洞约2.1m，樟巢螟危害；根部地面硬化、透气性差，叶片偏小、年生长量不足。',
      examiner: '林学专家组',
      organization: '市园林绿化科学研究院',
    },
    at(898)
  );
  createMeasure(
    db,
    a.id,
    {
      types: ['cavity_repair', 'pest_control', 'soil_amendment', 'protection'],
      detail: '空洞清腐消毒后聚氨酯发泡填充、外仿真树皮；根部破除硬化铺装120㎡并铺设透气格栅；化学防治两次；加装围栏与避雷针。',
      plannedStart: monthsAgoISO(today, 26),
      plannedEnd: monthsAgoISO(today, 25),
      actualEnd: monthsAgoISO(today, 25),
      status: 'completed',
      organization: '市园林工程有限公司',
      costYuan: 86000,
    },
    at(890)
  );
  const ta = startFollowup(db, a.id, at(755));
  const aRecords = [
    { month: 3, vigor: 'weak', days: 10, note: '新梢少量抽出，继续观察。' },
    { month: 6, vigor: 'normal', days: 5, note: '叶色转绿，空洞封堵处无异常。' },
    { month: 9, vigor: 'normal', days: 0, note: '根系周边土壤墒情良好。' },
    { month: 12, vigor: 'normal', days: -3, note: '越冬正常，抽枝整齐。' },
    { month: 18, vigor: 'vigorous', days: 2, note: '新梢生长量明显恢复。' },
    { month: 24, vigor: 'vigorous', days: 0, note: '冠幅恢复，年生长量达到复壮预期。' },
  ];
  for (const r of aRecords) {
    addFollowupRecord(
      db,
      ta.id,
      {
        month: r.month,
        followupDate: addMonthsISO(ta.baselineDate, r.month),
        alive: true,
        vigor: r.vigor,
        newIssues: [],
        newMeasures: r.note,
        observer: '周守根',
      },
      at(755 - r.month * 30 + r.days)
    );
  }
  finalizeTracking(
    db,
    ta.id,
    { result: 'success', note: '两年跟踪期内六次记录全部存活，生长势由衰弱恢复至旺盛，评定复壮成功。' },
    at(20)
  );

  // ---- B. 两年跟踪中，有节点逾期 ---------------------------------
  const b = createTree(
    db,
    {
      species: '香樟',
      latinName: 'Cinnamomum camphora (L.) Presl',
      grade: 'national_2',
      estimatedAge: 360,
      location: '老码头滨河公园 3 号亲水平台',
      heightM: 18,
      dbhCm: 96,
      crownWidthM: 21,
      ownerUnit: '滨河公园管理处',
      custodian: '吴丽萍',
      custodianPhone: '13800000002',
      remark: '常受汛期淹根影响。',
    },
    at(500)
  );
  createExam(
    db,
    b.id,
    {
      examDate: monthsAgoISO(today, 16),
      vigor: 'weak',
      issues: ['root_soil', 'canopy', 'pest'],
      diagnosis: '汛期积水致部分须根腐烂，冠顶枯枝约15%，伴生炭疽病斑。',
      examiner: '林学专家组',
      organization: '市园林绿化科学研究院',
    },
    at(495)
  );
  createMeasure(
    db,
    b.id,
    {
      types: ['root_irrigation', 'pruning', 'soil_amendment', 'pest_control'],
      detail: '开环状排水沟、复壮沟施有机肥；疏除枯死枝；杀菌剂喷施两次。',
      plannedStart: monthsAgoISO(today, 16),
      plannedEnd: monthsAgoISO(today, 15),
      actualEnd: monthsAgoISO(today, 15),
      status: 'completed',
      organization: '绿城养护有限公司',
      costYuan: 32000,
    },
    at(470)
  );
  const tb = startFollowup(db, b.id, at(455));
  addFollowupRecord(
    db,
    tb.id,
    {
      month: 3,
      followupDate: addMonthsISO(tb.baselineDate, 3),
      alive: true,
      vigor: 'weak',
      newIssues: [],
      newMeasures: '排水沟通畅，新根少量发生。',
      observer: '吴丽萍',
    },
    at(360)
  );
  addFollowupRecord(
    db,
    tb.id,
    {
      month: 6,
      followupDate: addMonthsISO(tb.baselineDate, 6),
      alive: true,
      vigor: 'normal',
      newIssues: [],
      newMeasures: '叶幕恢复，未见新病斑。',
      observer: '吴丽萍',
    },
    at(270)
  );
  // 9 月、12 月节点应填未填 → 截至今天已逾期

  // ---- C. 复壮中：体检衰弱，措施尚未完成 --------------------------
  const c = createTree(
    db,
    {
      species: '国槐',
      latinName: 'Sophora japonica L.',
      grade: 'national_3',
      estimatedAge: 150,
      location: '东关老街 42 号院门口',
      heightM: 13,
      dbhCm: 62,
      crownWidthM: 11,
      ownerUnit: '东关社区居委会',
      custodian: '马德福',
      custodianPhone: '13800000003',
      remark: '院内硬化铺装贴近树干。',
    },
    at(60)
  );
  createExam(
    db,
    c.id,
    {
      examDate: daysAgo(25),
      vigor: 'endangered',
      issues: ['root_soil', 'canopy', 'trunk_crack'],
      diagnosis: '树盘全部水泥硬化，主干南侧开裂长约1.2m，冠层三分之一枯枝，濒危。',
      examiner: '林学专家组',
      organization: '市园林绿化科学研究院',
    },
    at(25)
  );
  createMeasure(
    db,
    c.id,
    {
      types: ['support', 'pruning'],
      detail: '钢架支撑扶正、疏除枯枝减轻荷载。',
      plannedStart: daysAgo(10),
      plannedEnd: daysAgo(2),
      actualEnd: daysAgo(3),
      status: 'completed',
      organization: '绿城养护有限公司',
      costYuan: 15000,
    },
    at(12)
  );
  createMeasure(
    db,
    c.id,
    {
      types: ['soil_amendment', 'root_promotion', 'fertilizing'],
      detail: '拆除树盘硬化 25㎡，打孔透气并施复壮基质，促根处理。',
      plannedStart: daysAgo(2),
      plannedEnd: addMonthsISO(today, 1),
      status: 'in_progress',
      organization: '绿城养护有限公司',
      costYuan: 22000,
    },
    at(3)
  );

  // ---- D. 正常养护 ----------------------------------------------
  const d = createTree(
    db,
    {
      species: '马尾松',
      latinName: 'Pinus massoniana Lamb.',
      grade: 'national_3',
      estimatedAge: 130,
      location: '南山森林公园入口牌坊右侧',
      heightM: 21,
      dbhCm: 55,
      crownWidthM: 9,
      ownerUnit: '南山森林公园管理处',
      custodian: '郑海',
      custodianPhone: '13800000004',
    },
    at(200)
  );
  createExam(
    db,
    d.id,
    {
      examDate: daysAgo(40),
      vigor: 'normal',
      issues: [],
      diagnosis: '生长正常，针叶浓绿，无明显病虫害，按常规养护。',
      examiner: '林学专家组',
      organization: '市园林绿化科学研究院',
    },
    at(40)
  );

  // ---- E. 复壮失败：跟踪期内死亡，自动结案 ------------------------
  const e = createTree(
    db,
    {
      species: '柏木',
      latinName: 'Cupressus funebris Endl.',
      grade: 'national_2',
      estimatedAge: 310,
      location: '青云山古道半山亭旁',
      heightM: 16,
      dbhCm: 71,
      crownWidthM: 8,
      ownerUnit: '青云山林场',
      custodian: '许文彬',
      custodianPhone: '13800000005',
      remark: '去年山体小滑坡伤及根系。',
    },
    at(400)
  );
  createExam(
    db,
    e.id,
    {
      examDate: monthsAgoISO(today, 9),
      vigor: 'endangered',
      issues: ['root_soil', 'lean'],
      diagnosis: '滑坡拉断西侧主根，树体倾斜约12°，濒危。',
      examiner: '林学专家组',
      organization: '市园林绿化科学研究院',
    },
    at(300)
  );
  createMeasure(
    db,
    e.id,
    {
      types: ['support', 'root_promotion', 'soil_amendment'],
      detail: '钢丝绳拉结扶正，根部回填客土并促根。',
      plannedStart: monthsAgoISO(today, 9),
      plannedEnd: monthsAgoISO(today, 8),
      actualEnd: monthsAgoISO(today, 8),
      status: 'completed',
      organization: '青云山林场工程队',
      costYuan: 18000,
    },
    at(260)
  );
  const te = startFollowup(db, e.id, at(250));
  addFollowupRecord(
    db,
    te.id,
    {
      month: 3,
      followupDate: addMonthsISO(te.baselineDate, 3),
      alive: true,
      vigor: 'endangered',
      newIssues: ['canopy'],
      newMeasures: '上部鳞叶继续黄化，补水养护。',
      observer: '许文彬',
    },
    at(150)
  );
  addFollowupRecord(
    db,
    te.id,
    {
      month: 6,
      followupDate: addMonthsISO(te.baselineDate, 6),
      alive: false,
      vigor: 'dead',
      newIssues: [],
      newMeasures: '整株失绿、韧皮部干枯，确认为死亡。建议按规程留存影像并申请核销，补植同规格柏木。',
      observer: '林学专家组',
      remark: '现场拍照存档，已上报林业主管部门。',
    },
    at(60)
  );

  await mkdir(path.dirname(DB_FILE), { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  console.log(`演示数据已写入 ${DB_FILE}`);
  console.log(`共 ${Object.keys(db.trees).length} 株古树档案（银杏=成功结案 / 香樟=跟踪逾期 / 国槐=复壮中 / 马尾松=正常养护 / 柏木=失败结案）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
