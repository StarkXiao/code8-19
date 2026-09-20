"""HTTP 服务：路由与请求处理（仅标准库）。"""
import csv
import io
import re
import sqlite3
import traceback
import urllib.parse
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import views
from .db import connect
from .domain import (CONCLUSIONS, LEVELS, MEASURE_TYPES, SURVIVALS,
                     TREE_STATUS, parse_date, tracking_status)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

ROUTES = []


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile(pattern), fn))
        return fn
    return deco


class Response:
    def __init__(self, body=b"", status=200,
                 content_type="text/html; charset=utf-8", headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.body = body
        self.status = status
        self.content_type = content_type
        self.headers = headers or {}


def html(content, status=200):
    return Response(content, status)


def redirect(location):
    return Response(b"", 303, headers={"Location": location})


def quote(s):
    return urllib.parse.quote(s)


class Request:
    def __init__(self, method, path, params, form, conn):
        self.method = method
        self.path = path
        self.params = params   # GET 查询参数
        self.form = form       # POST 表单
        self.conn = conn       # 本请求的数据库连接


# ---------------------------------------------------------------- 工具


def _group_by(rows, key):
    out = {}
    for r in rows:
        out.setdefault(r[key], []).append(r)
    return out


def _get_tree(conn, tree_id):
    return conn.execute("SELECT * FROM trees WHERE id=?", (tree_id,)).fetchone()


def _latest(rows, date_field):
    best = None
    for r in rows:
        if r[date_field] and (best is None or r[date_field] > best[date_field]):
            best = r
    return best


def _values(form, fields):
    return {k: form.get(k, "").strip() for k in fields}


# ---------------------------------------------------------------- 工作台


@route("GET", r"^/$")
def dashboard(req):
    conn = req.conn
    trees = conn.execute("SELECT * FROM trees").fetchall()
    tmap = _group_by(conn.execute("SELECT * FROM treatments").fetchall(), "tree_id")
    fmap = _group_by(conn.execute("SELECT * FROM followups").fetchall(), "tree_id")
    cmap = _group_by(conn.execute("SELECT * FROM checkups").fetchall(), "tree_id")
    today = date.today()
    attention, in_period, abnormal = [], 0, 0
    for t in trees:
        if t["status"] == "死亡":
            continue  # 已死亡的古树不再产生跟踪任务
        info = tracking_status(tmap.get(t["id"], []), fmap.get(t["id"], []), today)
        if info["phase"] == "in_period":
            in_period += 1
            if info["needs_followup"]:
                attention.append((t, info))
        ck = _latest(cmap.get(t["id"], []), "check_date")
        if ck and ck["conclusion"] in ("衰弱", "濒危"):
            abnormal += 1
    # 从未跟踪过的排最前，其余按距上次跟踪月数降序
    attention.sort(key=lambda x: (x[1]["last_track"] is not None,
                                  -(x[1]["months_since"] or 0)))
    recent = conn.execute(
        "SELECT f.*, t.code AS tree_code, t.name AS tree_name FROM followups f "
        "JOIN trees t ON t.id = f.tree_id "
        "ORDER BY f.track_date DESC, f.id DESC LIMIT 8").fetchall()
    stats = {
        "total": len(trees),
        "alive": sum(1 for t in trees if t["status"] == "存活"),
        "dead": sum(1 for t in trees if t["status"] == "死亡"),
        "in_period": in_period,
        "attention": len(attention),
        "abnormal": abnormal,
    }
    return html(views.dashboard(stats, attention, recent,
                                msg=req.params.get("msg", "")))


# ---------------------------------------------------------------- 档案


@route("GET", r"^/trees$")
def trees(req):
    q = req.params.get("q", "").strip()
    level = req.params.get("level", "").strip()
    status = req.params.get("status", "").strip()
    sql = "SELECT * FROM trees WHERE 1=1"
    args = []
    if q:
        like = "%" + q + "%"
        sql += " AND (code LIKE ? OR name LIKE ? OR latin_name LIKE ? OR location LIKE ?)"
        args.extend([like, like, like, like])
    if level in LEVELS:
        sql += " AND level=?"
        args.append(level)
    if status in TREE_STATUS:
        sql += " AND status=?"
        args.append(status)
    sql += " ORDER BY code"
    rows = req.conn.execute(sql, args).fetchall()

    ids = [r["id"] for r in rows]
    tmap, fmap, cmap = {}, {}, {}
    if ids:
        marks = ",".join("?" * len(ids))
        for r in req.conn.execute(
                "SELECT * FROM treatments WHERE tree_id IN (%s)" % marks, ids):
            tmap.setdefault(r["tree_id"], []).append(r)
        for r in req.conn.execute(
                "SELECT * FROM followups WHERE tree_id IN (%s)" % marks, ids):
            fmap.setdefault(r["tree_id"], []).append(r)
        for r in req.conn.execute(
                "SELECT * FROM checkups WHERE tree_id IN (%s)" % marks, ids):
            cmap.setdefault(r["tree_id"], []).append(r)

    today = date.today()
    items = []
    for t in rows:
        info = tracking_status(tmap.get(t["id"], []), fmap.get(t["id"], []), today)
        items.append((t, info, _latest(cmap.get(t["id"], []), "check_date")))
    filters = {"q": q, "level": level, "status": status}
    return html(views.trees_list(items, filters, msg=req.params.get("msg", "")))


TREE_FIELDS = ("code", "name", "latin_name", "age", "level", "location",
               "lng", "lat", "owner", "status", "remark")


def _validate_tree(v):
    errors = {}
    if not v["code"]:
        errors["code"] = "请填写档案编号"
    if not v["name"]:
        errors["name"] = "请填写树种名称"
    if v["age"]:
        try:
            if int(v["age"]) < 0:
                raise ValueError
        except ValueError:
            errors["age"] = "树龄须为非负整数"
    for f in ("lng", "lat"):
        if v[f]:
            try:
                float(v[f])
            except ValueError:
                errors[f] = "须为数字"
    if v["level"] not in LEVELS:
        errors["level"] = "请选择保护级别"
    if v["status"] not in TREE_STATUS:
        errors["status"] = "请选择状态"
    return errors


def _tree_params(v):
    return (v["code"], v["name"], v["latin_name"],
            int(v["age"]) if v["age"] else None,
            v["level"], v["location"],
            float(v["lng"]) if v["lng"] else None,
            float(v["lat"]) if v["lat"] else None,
            v["owner"], v["status"], v["remark"])


@route("GET", r"^/trees/new$")
def tree_new(req):
    return html(views.tree_form({"level": "三级古树", "status": "存活"}, {},
                                "/trees/new", "新建古树档案"))


@route("POST", r"^/trees/new$")
def tree_create(req):
    v = _values(req.form, TREE_FIELDS)
    errors = _validate_tree(v)
    if not errors:
        try:
            cur = req.conn.execute(
                "INSERT INTO trees (code,name,latin_name,age,level,location,"
                "lng,lat,owner,status,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                _tree_params(v))
            req.conn.commit()
            return redirect("/trees/%d?msg=%s" % (cur.lastrowid, quote("档案已建立")))
        except sqlite3.IntegrityError:
            errors["code"] = "该编号已存在，请更换"
    return html(views.tree_form(v, errors, "/trees/new", "新建古树档案"), status=400)


@route("GET", r"^/trees/(\d+)$")
def tree_detail(req, tree_id):
    conn = req.conn
    tree = _get_tree(conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    checkups = conn.execute(
        "SELECT * FROM checkups WHERE tree_id=? ORDER BY check_date DESC, id DESC",
        (tree_id,)).fetchall()
    treatments = conn.execute(
        "SELECT * FROM treatments WHERE tree_id=? "
        "ORDER BY COALESCE(NULLIF(end_date,''), start_date) DESC, id DESC",
        (tree_id,)).fetchall()
    followups = conn.execute(
        "SELECT * FROM followups WHERE tree_id=? ORDER BY track_date DESC, id DESC",
        (tree_id,)).fetchall()
    info = tracking_status(treatments, followups)
    return html(views.tree_detail(tree, info, checkups, treatments, followups,
                                  msg=req.params.get("msg", "")))


@route("GET", r"^/trees/(\d+)/edit$")
def tree_edit(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    values = {k: ("" if tree[k] is None else str(tree[k])) for k in TREE_FIELDS}
    return html(views.tree_form(values, {}, "/trees/%d/edit" % tree["id"],
                                "编辑古树档案", cancel="/trees/%d" % tree["id"]))


@route("POST", r"^/trees/(\d+)/edit$")
def tree_update(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    v = _values(req.form, TREE_FIELDS)
    errors = _validate_tree(v)
    if not errors:
        try:
            req.conn.execute(
                "UPDATE trees SET code=?,name=?,latin_name=?,age=?,level=?,"
                "location=?,lng=?,lat=?,owner=?,status=?,remark=? WHERE id=?",
                _tree_params(v) + (tree["id"],))
            req.conn.commit()
            return redirect("/trees/%d?msg=%s" % (tree["id"], quote("档案已更新")))
        except sqlite3.IntegrityError:
            errors["code"] = "该编号已存在，请更换"
    return html(views.tree_form(v, errors, "/trees/%d/edit" % tree["id"],
                                "编辑古树档案",
                                cancel="/trees/%d" % tree["id"]), status=400)


@route("POST", r"^/trees/(\d+)/delete$")
def tree_delete(req, tree_id):
    req.conn.execute("DELETE FROM trees WHERE id=?", (tree_id,))
    req.conn.commit()
    return redirect("/trees?msg=%s" % quote("档案已删除"))


# ---------------------------------------------------------------- 体检记录


CHECKUP_FIELDS = ("check_date", "conclusion", "trunk", "crown", "root",
                  "pest", "suggestion", "examiner")


@route("GET", r"^/trees/(\d+)/checkups/new$")
def checkup_new(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    values = {"check_date": date.today().isoformat(), "conclusion": "健康"}
    return html(views.checkup_form(tree, values, {}))


@route("POST", r"^/trees/(\d+)/checkups/new$")
def checkup_create(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    v = _values(req.form, CHECKUP_FIELDS)
    errors = {}
    if not parse_date(v["check_date"]):
        errors["check_date"] = "请填写有效日期"
    if v["conclusion"] not in CONCLUSIONS:
        errors["conclusion"] = "请选择体检结论"
    if errors:
        return html(views.checkup_form(tree, v, errors), status=400)
    req.conn.execute(
        "INSERT INTO checkups (tree_id,check_date,conclusion,trunk,crown,root,"
        "pest,suggestion,examiner) VALUES (?,?,?,?,?,?,?,?,?)",
        (tree_id, v["check_date"], v["conclusion"], v["trunk"], v["crown"],
         v["root"], v["pest"], v["suggestion"], v["examiner"]))
    req.conn.commit()
    return redirect("/trees/%s?msg=%s" % (tree_id, quote("体检记录已保存")))


@route("POST", r"^/checkups/(\d+)/delete$")
def checkup_delete(req, rid):
    row = req.conn.execute("SELECT tree_id FROM checkups WHERE id=?",
                           (rid,)).fetchone()
    if row:
        req.conn.execute("DELETE FROM checkups WHERE id=?", (rid,))
        req.conn.commit()
        return redirect("/trees/%d?msg=%s" % (row["tree_id"], quote("记录已删除")))
    return redirect("/")


# ---------------------------------------------------------------- 复壮措施


TREATMENT_FIELDS = ("measure_type", "content", "start_date", "end_date", "executor")


@route("GET", r"^/trees/(\d+)/treatments/new$")
def treatment_new(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    values = {"measure_type": MEASURE_TYPES[0],
              "start_date": date.today().isoformat()}
    return html(views.treatment_form(tree, values, {}))


@route("POST", r"^/trees/(\d+)/treatments/new$")
def treatment_create(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    v = _values(req.form, TREATMENT_FIELDS)
    errors = {}
    if v["measure_type"] not in MEASURE_TYPES:
        errors["measure_type"] = "请选择措施类型"
    if not v["content"]:
        errors["content"] = "请填写措施内容"
    start = parse_date(v["start_date"])
    end = parse_date(v["end_date"])
    if v["start_date"] and not start:
        errors["start_date"] = "日期格式无效"
    if v["end_date"] and not end:
        errors["end_date"] = "日期格式无效"
    if start and end and end < start:
        errors["end_date"] = "完成日期不能早于开始日期"
    if errors:
        return html(views.treatment_form(tree, v, errors), status=400)
    req.conn.execute(
        "INSERT INTO treatments (tree_id,measure_type,content,start_date,"
        "end_date,executor) VALUES (?,?,?,?,?,?)",
        (tree_id, v["measure_type"], v["content"], v["start_date"],
         v["end_date"], v["executor"]))
    req.conn.commit()
    return redirect("/trees/%s?msg=%s"
                    % (tree_id, quote("复壮措施已登记，自完成日期起进入两年跟踪期")))


@route("POST", r"^/treatments/(\d+)/delete$")
def treatment_delete(req, rid):
    row = req.conn.execute("SELECT tree_id FROM treatments WHERE id=?",
                           (rid,)).fetchone()
    if row:
        req.conn.execute("DELETE FROM treatments WHERE id=?", (rid,))
        req.conn.commit()
        return redirect("/trees/%d?msg=%s" % (row["tree_id"], quote("记录已删除")))
    return redirect("/")


# ---------------------------------------------------------------- 跟踪记录


FOLLOWUP_FIELDS = ("track_date", "survival", "growth_desc", "recorder")


def _followup_context(req, tree_id):
    """跟踪表单需要展示当前跟踪期。"""
    treatments = req.conn.execute(
        "SELECT * FROM treatments WHERE tree_id=?", (tree_id,)).fetchall()
    followups = req.conn.execute(
        "SELECT * FROM followups WHERE tree_id=?", (tree_id,)).fetchall()
    return tracking_status(treatments, followups)


@route("GET", r"^/trees/(\d+)/followups/new$")
def followup_new(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    values = {"track_date": date.today().isoformat(), "survival": "存活"}
    return html(views.followup_form(tree, values, {},
                                    info=_followup_context(req, tree_id)))


@route("POST", r"^/trees/(\d+)/followups/new$")
def followup_create(req, tree_id):
    tree = _get_tree(req.conn, tree_id)
    if not tree:
        return html(views.not_found(), 404)
    v = _values(req.form, FOLLOWUP_FIELDS)
    errors = {}
    if not parse_date(v["track_date"]):
        errors["track_date"] = "请填写有效日期"
    if v["survival"] not in SURVIVALS:
        errors["survival"] = "请选择存活状态"
    if errors:
        return html(views.followup_form(tree, v, errors,
                                        info=_followup_context(req, tree_id)),
                    status=400)
    req.conn.execute(
        "INSERT INTO followups (tree_id,track_date,survival,growth_desc,recorder)"
        " VALUES (?,?,?,?,?)",
        (tree_id, v["track_date"], v["survival"], v["growth_desc"], v["recorder"]))
    if v["survival"] == "死亡":
        req.conn.execute("UPDATE trees SET status='死亡' WHERE id=?", (tree_id,))
        msg = "跟踪记录已保存，档案状态已自动更新为「死亡」"
    else:
        msg = "跟踪记录已保存"
    req.conn.commit()
    return redirect("/trees/%s?msg=%s" % (tree_id, quote(msg)))


@route("POST", r"^/followups/(\d+)/delete$")
def followup_delete(req, rid):
    row = req.conn.execute("SELECT tree_id FROM followups WHERE id=?",
                           (rid,)).fetchone()
    if row:
        req.conn.execute("DELETE FROM followups WHERE id=?", (rid,))
        req.conn.commit()
        return redirect("/trees/%d?msg=%s" % (row["tree_id"], quote("记录已删除")))
    return redirect("/")


# ---------------------------------------------------------------- 导出


@route("GET", r"^/export/trees.csv$")
def export_csv(req):
    conn = req.conn
    trees = conn.execute("SELECT * FROM trees ORDER BY code").fetchall()
    tmap = _group_by(conn.execute("SELECT * FROM treatments").fetchall(), "tree_id")
    fmap = _group_by(conn.execute("SELECT * FROM followups").fetchall(), "tree_id")
    cmap = _group_by(conn.execute("SELECT * FROM checkups").fetchall(), "tree_id")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["档案编号", "树种", "拉丁学名", "树龄", "保护级别", "生长地点",
                "权属/管护单位", "档案状态", "最近体检日期", "最近体检结论",
                "跟踪期起算", "跟踪期截止", "最近跟踪日期", "最近存活状态"])
    today = date.today()
    for t in trees:
        ck = _latest(cmap.get(t["id"], []), "check_date")
        info = tracking_status(tmap.get(t["id"], []), fmap.get(t["id"], []), today)
        w.writerow([
            t["code"], t["name"], t["latin_name"], t["age"] or "", t["level"],
            t["location"], t["owner"], t["status"],
            ck["check_date"] if ck else "", ck["conclusion"] if ck else "",
            info.get("start") or "", info.get("deadline") or "",
            info.get("last_track") or "", info.get("survival") or "",
        ])
    data = out.getvalue().encode("utf-8-sig")  # 带 BOM，Excel 打开不乱码
    return Response(data, content_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition":
                             "attachment; filename=trees.csv"})


# ---------------------------------------------------------------- 静态文件


_CONTENT_TYPES = {".css": "text/css; charset=utf-8",
                  ".js": "text/javascript; charset=utf-8",
                  ".png": "image/png", ".svg": "image/svg+xml"}


@route("GET", r"^/static/([\w.-]+)$")
def static_file(req, name):
    path = STATIC_DIR / name
    if not path.is_file():
        return Response(b"not found", 404, "text/plain; charset=utf-8")
    ctype = _CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return Response(path.read_bytes(), content_type=ctype)


# ---------------------------------------------------------------- 服务器


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "TreeTracker/1.0"

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        form = {}
        if method == "POST":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            body = self.rfile.read(length).decode("utf-8", "replace")
            form = {k: v[0] for k, v in urllib.parse.parse_qs(body).items()}
        req = Request(method, path, params, form, connect())
        try:
            resp = None
            for m, pattern, fn in ROUTES:
                if m != method:
                    continue
                match = pattern.match(path)
                if match:
                    resp = fn(req, *match.groups())
                    break
            if resp is None:
                resp = html(views.not_found(), 404)
        except Exception:
            traceback.print_exc()
            resp = html(views.layout("错误",
                                     '<section class="panel"><h1>服务器内部错误</h1>'
                                     '<p><a href="/">返回工作台</a></p></section>'),
                        500)
        finally:
            req.conn.close()
        try:
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.content_type)
            self.send_header("Content-Length", str(len(resp.body)))
            for k, v in resp.headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(resp.body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):
        pass  # 静默访问日志


def serve(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), Handler)
    print("古树名木复壮跟踪系统")
    print("访问地址: http://%s:%d" % (host, port))
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
