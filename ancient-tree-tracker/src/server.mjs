// HTTP 服务：零依赖（node:http）。静态托管 public/，JSON API 挂在 /api。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDB } from './db.mjs';
import {
  ApiError,
  TREE_GRADES,
  VIGORS,
  ISSUE_TYPES,
  MEASURE_TYPES,
  MEASURE_STATUSES,
  FOLLOWUP_MONTHS,
  createTree,
  updateTree,
  createExam,
  createMeasure,
  updateMeasure,
  startFollowup,
  addFollowupRecord,
  updateFollowupRecord,
  finalizeTracking,
  extendTracking,
  buildTreeView,
  listTrees,
  buildStats,
  isValidISODate,
  todayStr,
} from './domain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = path.resolve(ROOT, process.env.DB_FILE || 'data/db.json');

// 演示/测试可固定"今天"：TRACKER_TODAY=2026-10-01
const TODAY =
  process.env.TRACKER_TODAY && isValidISODate(process.env.TRACKER_TODAY) ? process.env.TRACKER_TODAY : todayStr();

const db = new JsonDB(DB_FILE);

// ---------------------------------------------------------------- 工具

function sendJSON(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(buf),
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) return reject(new ApiError(413, 'TOO_LARGE', '请求体过大（上限 1MB）'));
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'BAD_JSON', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res, filePath) {
  const buf = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  res.end(buf);
}

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJSON(res, 403, { error: { code: 'FORBIDDEN', message: '禁止访问' } });
  }
  if (existsSync(filePath)) return serveFile(res, filePath);
  // SPA 回退到 index.html
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (existsSync(index)) return serveFile(res, index);
  return sendJSON(res, 404, { error: { code: 'NOT_FOUND', message: '前端文件缺失' } });
}

// ---------------------------------------------------------------- 路由
// handler 统一签名 ({ body, params, url }) => 返回值即响应 JSON

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
const p0 = (p) => p[0];

route('GET', /^\/api\/constants$/, () => ({
  grades: TREE_GRADES,
  vigors: VIGORS,
  issueTypes: ISSUE_TYPES,
  measureTypes: MEASURE_TYPES,
  measureStatuses: MEASURE_STATUSES,
  followupMonths: FOLLOWUP_MONTHS,
  today: TODAY,
}));

route('GET', /^\/api\/stats$/, () => buildStats(db.data, TODAY));

route('GET', /^\/api\/trees$/, ({ url }) =>
  listTrees(db.data, {
    q: url.searchParams.get('q') || '',
    status: url.searchParams.get('status') || '',
    today: TODAY,
  })
);

route('POST', /^\/api\/trees$/, ({ body }) => createTree(db.data, body));

route('GET', /^\/api\/trees\/([^/]+)$/, ({ params }) => {
  const v = buildTreeView(db.data, p0(params), TODAY);
  if (!v) throw new ApiError(404, 'NOT_FOUND', '档案不存在');
  return v;
});

route('PATCH', /^\/api\/trees\/([^/]+)$/, ({ body, params }) => updateTree(db.data, p0(params), body));

route('POST', /^\/api\/trees\/([^/]+)\/exams$/, ({ body, params }) => createExam(db.data, p0(params), body));

route('POST', /^\/api\/trees\/([^/]+)\/measures$/, ({ body, params }) =>
  createMeasure(db.data, p0(params), body)
);

route('PATCH', /^\/api\/measures\/([^/]+)$/, ({ body, params }) => updateMeasure(db.data, p0(params), body));

route('POST', /^\/api\/trees\/([^/]+)\/followup\/start$/, ({ params }) => startFollowup(db.data, p0(params)));

route('POST', /^\/api\/trackings\/([^/]+)\/records$/, ({ body, params }) =>
  addFollowupRecord(db.data, p0(params), body)
);

route('PATCH', /^\/api\/followup-records\/([^/]+)$/, ({ body, params }) =>
  updateFollowupRecord(db.data, p0(params), body)
);

route('POST', /^\/api\/trackings\/([^/]+)\/extend$/, ({ params }) => extendTracking(db.data, p0(params)));

route('POST', /^\/api\/trackings\/([^/]+)\/finalize$/, ({ body, params }) =>
  finalizeTracking(db.data, p0(params), body)
);

// ---------------------------------------------------------------- 启动

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const found = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!found) throw new ApiError(404, 'NOT_FOUND', '接口不存在');
      const match = url.pathname.match(found.pattern);
      const params = match.slice(1);
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const result = await found.handler({ body, params, url });
      if (req.method !== 'GET') await db.save();
      return sendJSON(res, 200, result ?? { ok: true });
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    if (err instanceof ApiError) {
      return sendJSON(res, err.status, { error: { code: err.code, message: err.message } });
    }
    console.error('[server]', err);
    return sendJSON(res, 500, { error: { code: 'INTERNAL', message: '服务器内部错误' } });
  }
});

db.load().then(() => {
  server.listen(PORT, () => {
    console.log(`古树名木复壮跟踪系统已启动: http://localhost:${PORT}`);
    console.log(`数据库: ${DB_FILE}`);
    if (TODAY !== todayStr()) console.log(`(演示日期固定为 ${TODAY})`);
  });
});

export { server, db };
