"""页面渲染：所有函数返回 HTML 字符串。

约定：用户数据一律经 h() 转义；使用 % 格式化以兼容 Python 3.11 之前的 f-string 限制。
"""
from .domain import (CONCLUSIONS, FOLLOWUP_INTERVAL_MONTHS, LEVELS,
                     MEASURE_TYPES, SURVIVALS, TRACKING_YEARS, TREE_STATUS)
from .helpers import h

# ---------------------------------------------------------------- 通用小部件


def badge(text, cls):
    return '<span class="badge b-%s">%s</span>' % (h(cls), h(text))


def survival_badge(s):
    return badge(s, {"存活": "green", "衰弱": "amber", "死亡": "dark"}.get(s, "gray"))


def conclusion_badge(s):
    return badge(s, {"健康": "green", "基本健康": "green",
                     "衰弱": "amber", "濒危": "red"}.get(s, "gray"))


def status_badge(s):
    return badge(s, {"存活": "green", "死亡": "dark", "迁移": "gray"}.get(s, "gray"))


def phase_badge(info):
    """跟踪状态徽章。"""
    if info["phase"] == "no_treatment":
        return badge("未复壮", "gray")
    if info["phase"] == "expired":
        return badge("跟踪期满", "gray")
    if info["needs_followup"]:
        return badge("待跟踪", "red")
    return badge("跟踪期内", "green")


def layout(title, content, msg=None):
    flash = '<div class="flash">%s</div>' % h(msg) if msg else ""
    return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s · 古树名木复壮跟踪系统</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<nav class="topnav"><div class="wrap nav-in">
  <a class="brand" href="/">🌳 古树名木复壮跟踪系统</a>
  <div class="links">
    <a href="/">工作台</a>
    <a href="/trees">古树档案</a>
    <a href="/trees/new">＋新建档案</a>
  </div>
</div></nav>
<main class="wrap">
%s
%s
</main>
<footer class="wrap footer">建档 → 体检 → 复壮 → 两年存活跟踪 · 数据保存在本地 SQLite（data/trees.db）</footer>
</body>
</html>""" % (h(title), flash, content)


# ---------------------------------------------------------------- 表单控件


def _err(errors, name):
    if errors and name in errors:
        return '<span class="error">%s</span>' % h(errors[name])
    return ""


def input_field(name, label, value="", type_="text", required=False, errors=None,
                hint="", placeholder=""):
    req = '<span class="req">*</span>' if required else ""
    reqattr = " required" if required else ""
    hint_html = '<span class="hint">%s</span>' % h(hint) if hint else ""
    return ('<label class="field"><span class="label">%s%s</span>'
            '<input type="%s" name="%s" value="%s" placeholder="%s"%s>'
            '%s%s</label>'
            % (h(label), req, type_, h(name), h(value), h(placeholder), reqattr,
               _err(errors, name), hint_html))


def select_field(name, label, options, value="", required=False, errors=None, hint=""):
    req = '<span class="req">*</span>' if required else ""
    opts = []
    for o in options:
        sel = " selected" if o == value else ""
        opts.append('<option value="%s"%s>%s</option>' % (h(o), sel, h(o)))
    hint_html = '<span class="hint">%s</span>' % h(hint) if hint else ""
    return ('<label class="field"><span class="label">%s%s</span>'
            '<select name="%s">%s</select>%s%s</label>'
            % (h(label), req, h(name), "".join(opts), _err(errors, name), hint_html))


def textarea_field(name, label, value="", required=False, errors=None, rows=3,
                   placeholder=""):
    req = '<span class="req">*</span>' if required else ""
    reqattr = " required" if required else ""
    return ('<label class="field"><span class="label">%s%s</span>'
            '<textarea name="%s" rows="%d" placeholder="%s"%s>%s</textarea>%s</label>'
            % (h(label), req, h(name), rows, h(placeholder), reqattr, h(value),
               _err(errors, name)))


# ---------------------------------------------------------------- 工作台


def dashboard(stats, attention, recent, msg=None):
    warn_cls = " warn" if stats["attention"] else ""
    cards = """
<div class="cards">
  <div class="card"><div class="num">%d</div><div class="cap">建档古树<span class="sub">存活 %d · 死亡 %d</span></div></div>
  <div class="card"><div class="num">%d</div><div class="cap">两年跟踪期内</div></div>
  <div class="card%s"><div class="num">%d</div><div class="cap">待跟踪提醒<span class="sub">超过 %d 个月未跟踪</span></div></div>
  <div class="card"><div class="num">%d</div><div class="cap">体检异常<span class="sub">最近结论为衰弱/濒危</span></div></div>
</div>""" % (stats["total"], stats["alive"], stats["dead"],
             stats["in_period"], warn_cls, stats["attention"],
             FOLLOWUP_INTERVAL_MONTHS, stats["abnormal"])

    if attention:
        rows = []
        for tree, info in attention:
            if info["last_track"] is None:
                last = '<span class="muted">本期内尚未跟踪</span>'
            else:
                last = "%s（%d 个月前）" % (info["last_track"], info["months_since"])
            rows.append(
                "<tr><td><a href='/trees/%d'>%s</a></td><td>%s</td><td>%s</td>"
                "<td>%s</td><td>%s</td>"
                '<td><a class="btn small" href="/trees/%d/followups/new">登记跟踪</a></td></tr>'
                % (tree["id"], h(tree["code"]), h(tree["name"]),
                   info["start"], info["deadline"], last, tree["id"]))
        attention_html = """
<section class="panel">
  <h2>⚠️ 待跟踪提醒 <span class="muted">（复壮完成后 %d 年内，每 %d 个月至少记录一次存活情况）</span></h2>
  <table><thead><tr><th>编号</th><th>树种</th><th>跟踪期起算</th><th>跟踪期截止</th><th>上次跟踪</th><th></th></tr></thead>
  <tbody>%s</tbody></table>
</section>""" % (TRACKING_YEARS, FOLLOWUP_INTERVAL_MONTHS, "".join(rows))
    else:
        attention_html = ('<section class="panel"><h2>待跟踪提醒</h2>'
                          '<p class="empty">当前没有超期未跟踪的古树 🎉</p></section>')

    recent_html = ""
    if recent:
        rrows = []
        for r in recent:
            rrows.append(
                "<tr><td>%s</td><td><a href='/trees/%d'>%s %s</a></td>"
                "<td>%s</td><td>%s</td><td>%s</td></tr>"
                % (h(r["track_date"]), r["tree_id"], h(r["tree_code"]),
                   h(r["tree_name"]), survival_badge(r["survival"]),
                   h(r["growth_desc"] or "—"), h(r["recorder"] or "—")))
        recent_html = """
<section class="panel">
  <h2>最近跟踪动态</h2>
  <table><thead><tr><th>日期</th><th>古树</th><th>存活状态</th><th>生长情况</th><th>记录人</th></tr></thead>
  <tbody>%s</tbody></table>
</section>""" % "".join(rrows)

    return layout("工作台", cards + attention_html + recent_html, msg)


# ---------------------------------------------------------------- 档案列表


def trees_list(items, filters, msg=None):
    level_opts = ['<option value="">全部级别</option>']
    for l in LEVELS:
        sel = " selected" if filters["level"] == l else ""
        level_opts.append('<option value="%s"%s>%s</option>' % (h(l), sel, h(l)))
    status_opts = ['<option value="">全部状态</option>']
    for s in TREE_STATUS:
        sel = " selected" if filters["status"] == s else ""
        status_opts.append('<option value="%s"%s>%s</option>' % (h(s), sel, h(s)))

    rows = []
    for tree, info, ck in items:
        if ck:
            ck_html = "%s %s" % (h(ck["check_date"]), conclusion_badge(ck["conclusion"]))
        else:
            ck_html = '<span class="muted">未体检</span>'
        if tree["status"] == "死亡":
            track_html = badge("已终止", "gray")
        else:
            track_html = phase_badge(info)
        rows.append("""
<tr>
  <td><a href="/trees/%d">%s</a></td>
  <td>%s</td>
  <td>%s</td>
  <td>%s</td>
  <td>%s</td>
  <td>%s</td>
  <td>%s</td>
  <td>%s</td>
</tr>""" % (tree["id"], h(tree["code"]), h(tree["name"]),
            ("%d 年" % tree["age"]) if tree["age"] else "—",
            h(tree["level"]), h(tree["location"] or "—"),
            status_badge(tree["status"]), ck_html, track_html))

    if rows:
        table = ("<table><thead><tr><th>编号</th><th>树种</th><th>树龄</th><th>级别</th>"
                 "<th>生长地点</th><th>状态</th><th>最近体检</th><th>跟踪状态</th></tr></thead>"
                 "<tbody>%s</tbody></table>" % "".join(rows))
    else:
        table = '<p class="empty">没有符合条件的古树档案。</p>'

    body = """
<div class="page-head">
  <h1>古树档案 <span class="muted">共 %d 株</span></h1>
  <div class="actions">
    <a class="btn" href="/trees/new">＋ 新建档案</a>
    <a class="btn ghost" href="/export/trees.csv">导出 CSV</a>
  </div>
</div>
<form method="get" action="/trees" class="panel filters">
  <input type="search" name="q" value="%s" placeholder="搜索编号 / 树种 / 地点">
  <select name="level">%s</select>
  <select name="status">%s</select>
  <button class="btn small" type="submit">筛选</button>
  <a class="btn ghost small" href="/trees">重置</a>
</form>
<section class="panel">%s</section>""" % (len(items), h(filters["q"]),
                                          "".join(level_opts),
                                          "".join(status_opts), table)
    return layout("古树档案", body, msg)


# ---------------------------------------------------------------- 档案表单


def tree_form(values, errors, action, title, cancel="/trees", msg=None):
    v = values
    body = """
<h1>%s</h1>
<form method="post" action="%s" class="panel form">
  <div class="grid2">%s%s</div>
  <div class="grid2">%s%s</div>
  %s
  <div class="grid2">%s%s</div>
  <div class="grid2">%s%s</div>
  %s%s
  <div class="form-actions">
    <button class="btn" type="submit">保存</button>
    <a class="btn ghost" href="%s">取消</a>
  </div>
</form>""" % (
        h(title), h(action),
        input_field("code", "档案编号", v.get("code"), required=True, errors=errors,
                    placeholder="如 J-A0001"),
        input_field("name", "树种名称", v.get("name"), required=True, errors=errors,
                    placeholder="如 银杏"),
        input_field("latin_name", "拉丁学名", v.get("latin_name"), errors=errors,
                    placeholder="如 Ginkgo biloba"),
        input_field("age", "树龄（年）", v.get("age"), type_="number", errors=errors),
        input_field("location", "生长地点", v.get("location"), errors=errors),
        select_field("level", "保护级别", LEVELS,
                     v.get("level") or "三级古树", errors=errors),
        input_field("lng", "经度", v.get("lng"), errors=errors, placeholder="选填"),
        input_field("lat", "纬度", v.get("lat"), errors=errors, placeholder="选填"),
        input_field("owner", "权属/管护单位", v.get("owner"), errors=errors),
        select_field("status", "档案状态", TREE_STATUS,
                     v.get("status") or "存活", errors=errors),
        textarea_field("remark", "备注", v.get("remark"), errors=errors),
        h(cancel))
    return layout(title, body, msg)


# ---------------------------------------------------------------- 档案详情


def _tracking_banner(info):
    phase = info["phase"]
    if phase == "no_treatment":
        return ('<div class="track-banner gray"><strong>未进入跟踪期</strong>'
                '尚未登记复壮措施；登记复壮措施并填写完成日期后，自动进入 %d 年存活跟踪期。'
                '</div>' % TRACKING_YEARS)
    if phase == "expired":
        return ('<div class="track-banner gray"><strong>跟踪期已满</strong>'
                '跟踪期 %s ~ %s 已结束。期内最近存活状态：%s。'
                '</div>' % (info["start"], info["deadline"], h(info["survival"] or "无记录")))
    base = "跟踪期 %s ~ %s（复壮完成后 %d 年）" % (
        info["start"], info["deadline"], TRACKING_YEARS)
    if info["last_track"] is None:
        return ('<div class="track-banner red"><strong>待跟踪</strong>：%s。'
                '本跟踪期内尚未登记任何跟踪记录，请尽快安排。</div>' % base)
    if info["needs_followup"]:
        return ('<div class="track-banner red"><strong>待跟踪</strong>：%s。'
                '上次跟踪为 %s（%d 个月前），已超过 %d 个月，请尽快登记跟踪记录。</div>'
                % (base, info["last_track"], info["months_since"],
                   FOLLOWUP_INTERVAL_MONTHS))
    return ('<div class="track-banner green"><strong>跟踪正常</strong>：%s。'
            '上次跟踪 %s，建议下次跟踪不晚于 %s。</div>'
            % (base, info["last_track"], info["next_due"]))


_KIND_META = {
    "checkup": ("体检", "blue"),
    "treatment": ("复壮措施", "green"),
    "followup": ("跟踪记录", "amber"),
}


def _event_item(kind, date_str, row):
    label, cls = _KIND_META[kind]
    if kind == "checkup":
        title = "体检结论 %s" % conclusion_badge(row["conclusion"])
        lines = [("树干", row["trunk"]), ("树冠", row["crown"]), ("根系", row["root"]),
                 ("病虫害", row["pest"]), ("处理建议", row["suggestion"]),
                 ("体检单位/人员", row["examiner"])]
        delete_url = "/checkups/%d/delete" % row["id"]
    elif kind == "treatment":
        title = h(row["measure_type"])
        period = ""
        if row["start_date"] or row["end_date"]:
            period = "%s ~ %s" % (row["start_date"] or "?", row["end_date"] or "?")
        lines = [("措施内容", row["content"]), ("实施周期", period),
                 ("实施单位", row["executor"])]
        delete_url = "/treatments/%d/delete" % row["id"]
    else:
        title = "存活状态 %s" % survival_badge(row["survival"])
        lines = [("生长情况", row["growth_desc"]), ("记录人", row["recorder"])]
        delete_url = "/followups/%d/delete" % row["id"]

    lis = []
    for k, v in lines:
        if v:
            lis.append("<div><span class='k'>%s：</span>%s</div>" % (h(k), h(v)))
    return """
<li class="ev-%s">
  <div class="ev-head">
    <span class="ev-kind">%s</span><span class="ev-date">%s</span>
    <form method="post" action="%s" class="inline"
          onsubmit="return confirm('确定删除该条记录吗？');"><button class="link-danger">删除</button></form>
  </div>
  <div class="ev-title">%s</div>
  <div class="ev-body">%s</div>
</li>""" % (cls, h(label), h(date_str or "—"), delete_url, title, "".join(lis))


def tree_detail(tree, info, checkups, treatments, followups, msg=None):
    age = ("%d 年" % tree["age"]) if tree["age"] else "未知"
    coords = ""
    if tree["lng"] is not None and tree["lat"] is not None:
        coords = "%s, %s" % (tree["lng"], tree["lat"])

    head = """
<p><a href="/trees">← 返回档案列表</a></p>
<div class="page-head">
  <div>
    <h1>%s · %s</h1>
    <div class="tags">%s %s %s</div>
  </div>
  <div class="actions">
    <a class="btn ghost" href="/trees/%d/edit">编辑档案</a>
    <form method="post" action="/trees/%d/delete" class="inline"
          onsubmit="return confirm('确定删除该档案及其全部体检、复壮、跟踪记录吗？此操作不可恢复。');"><button class="btn danger">删除档案</button></form>
  </div>
</div>""" % (h(tree["code"]), h(tree["name"]),
             badge(tree["level"], "green"), status_badge(tree["status"]),
             badge("树龄 " + age, "gray"), tree["id"], tree["id"])

    remark = ('<p class="remark">备注：%s</p>' % h(tree["remark"])) if tree["remark"] else ""
    grid = """
<section class="panel">
  <h2>档案信息</h2>
  <dl class="grid">
    <div><dt>拉丁学名</dt><dd>%s</dd></div>
    <div><dt>树龄</dt><dd>%s</dd></div>
    <div><dt>保护级别</dt><dd>%s</dd></div>
    <div><dt>生长地点</dt><dd>%s</dd></div>
    <div><dt>经纬度</dt><dd>%s</dd></div>
    <div><dt>权属/管护单位</dt><dd>%s</dd></div>
    <div><dt>档案状态</dt><dd>%s</dd></div>
    <div><dt>建档时间</dt><dd>%s</dd></div>
  </dl>
  %s
</section>""" % (h(tree["latin_name"] or "—"), h(age), h(tree["level"]),
                 h(tree["location"] or "—"), h(coords or "—"),
                 h(tree["owner"] or "—"), status_badge(tree["status"]),
                 h((tree["created_at"] or "")[:10]), remark)

    if tree["status"] == "死亡":
        banner = ('<div class="track-banner gray"><strong>已死亡</strong>'
                  '该古树已确认死亡，两年存活跟踪终止，档案与历史记录保留备查。</div>')
    else:
        banner = _tracking_banner(info)

    actions = """
<div class="record-actions">
  <a class="btn" href="/trees/%d/checkups/new">＋ 体检记录</a>
  <a class="btn" href="/trees/%d/treatments/new">＋ 复壮措施</a>
  <a class="btn" href="/trees/%d/followups/new">＋ 跟踪记录</a>
</div>""" % (tree["id"], tree["id"], tree["id"])

    events = []
    for c in checkups:
        events.append(("checkup", c["check_date"], c))
    for t in treatments:
        events.append(("treatment", t["end_date"] or t["start_date"], t))
    for f in followups:
        events.append(("followup", f["track_date"], f))
    events.sort(key=lambda e: (e[1] or ""), reverse=True)

    if events:
        timeline = '<ul class="timeline">%s</ul>' % "".join(
            _event_item(kind, d, row) for kind, d, row in events)
    else:
        timeline = '<p class="empty">暂无记录，请先添加体检或复壮措施。</p>'

    timeline_panel = """
<section class="panel">
  <h2>档案时间线 <span class="muted">体检 %d · 复壮 %d · 跟踪 %d</span></h2>
  %s
</section>""" % (len(checkups), len(treatments), len(followups), timeline)

    title = "%s %s" % (tree["code"], tree["name"])
    return layout(title, head + banner + grid + actions + timeline_panel, msg)


# ---------------------------------------------------------------- 记录表单


def checkup_form(tree, values, errors, msg=None):
    body = """
<p><a href="/trees/%d">← 返回档案</a></p>
<h1>添加体检记录 <small>%s %s</small></h1>
<form method="post" class="panel form">
  <div class="grid2">%s%s</div>
  <div class="grid2">%s%s</div>
  <div class="grid2">%s%s</div>
  %s%s
  <div class="form-actions">
    <button class="btn" type="submit">保存体检记录</button>
    <a class="btn ghost" href="/trees/%d">取消</a>
  </div>
</form>""" % (
        tree["id"], h(tree["code"]), h(tree["name"]),
        input_field("check_date", "体检日期", values.get("check_date"),
                    type_="date", required=True, errors=errors),
        select_field("conclusion", "体检结论", CONCLUSIONS,
                     values.get("conclusion") or "健康", errors=errors),
        input_field("trunk", "树干状况", values.get("trunk"), errors=errors,
                    placeholder="如：主干空洞、腐朽程度"),
        input_field("crown", "树冠状况", values.get("crown"), errors=errors,
                    placeholder="如：枯枝比例、偏冠情况"),
        input_field("root", "根系状况", values.get("root"), errors=errors,
                    placeholder="如：裸露、板结、腐烂"),
        input_field("pest", "病虫害情况", values.get("pest"), errors=errors,
                    placeholder="如：天牛危害、叶部病害"),
        textarea_field("suggestion", "处理建议", values.get("suggestion"),
                       errors=errors, placeholder="体检后建议采取的复壮或保护措施"),
        input_field("examiner", "体检单位/人员", values.get("examiner"), errors=errors),
        tree["id"])
    return layout("添加体检记录", body, msg)


def treatment_form(tree, values, errors, msg=None):
    body = """
<p><a href="/trees/%d">← 返回档案</a></p>
<h1>登记复壮措施 <small>%s %s</small></h1>
<form method="post" class="panel form">
  %s%s
  <div class="grid2">%s%s</div>
  %s
  <div class="form-actions">
    <button class="btn" type="submit">保存复壮措施</button>
    <a class="btn ghost" href="/trees/%d">取消</a>
  </div>
</form>""" % (
        tree["id"], h(tree["code"]), h(tree["name"]),
        select_field("measure_type", "措施类型", MEASURE_TYPES,
                     values.get("measure_type") or MEASURE_TYPES[0], errors=errors),
        textarea_field("content", "措施内容", values.get("content"), required=True,
                       errors=errors, placeholder="具体做法、用量、部位等"),
        input_field("start_date", "开始日期", values.get("start_date"),
                    type_="date", errors=errors),
        input_field("end_date", "完成日期", values.get("end_date"),
                    type_="date", errors=errors,
                    hint="完成日期用于起算 %d 年跟踪期" % TRACKING_YEARS),
        input_field("executor", "实施单位", values.get("executor"), errors=errors),
        tree["id"])
    return layout("登记复壮措施", body, msg)


def followup_form(tree, values, errors, info=None, msg=None):
    ctx = ""
    if info and info["phase"] != "no_treatment":
        ctx = ('<p class="hint" style="margin-top:0">当前跟踪期：%s ~ %s</p>'
               % (info["start"], info["deadline"]))
    body = """
<p><a href="/trees/%d">← 返回档案</a></p>
<h1>添加跟踪记录 <small>%s %s</small></h1>
<form method="post" class="panel form">
  %s
  <div class="grid2">%s%s</div>
  %s%s
  <div class="form-actions">
    <button class="btn" type="submit">保存跟踪记录</button>
    <a class="btn ghost" href="/trees/%d">取消</a>
  </div>
</form>""" % (
        tree["id"], h(tree["code"]), h(tree["name"]),
        ctx,
        input_field("track_date", "跟踪日期", values.get("track_date"),
                    type_="date", required=True, errors=errors),
        select_field("survival", "存活状态", SURVIVALS,
                     values.get("survival") or "存活", errors=errors,
                     hint="选择「死亡」后，档案状态将自动更新为死亡"),
        textarea_field("growth_desc", "生长情况", values.get("growth_desc"),
                       errors=errors,
                       placeholder="新梢生长、叶色、枯枝变化、复壮措施效果等"),
        input_field("recorder", "记录人", values.get("recorder"), errors=errors),
        tree["id"])
    return layout("添加跟踪记录", body, msg)


# ---------------------------------------------------------------- 其他


def not_found():
    return layout("页面不存在",
                  '<section class="panel"><h1>404</h1><p>页面或档案不存在。</p>'
                  '<p><a class="btn" href="/">返回工作台</a></p></section>')
