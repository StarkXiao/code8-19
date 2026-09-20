"""核心业务规则：两年跟踪期与存活状态计算。"""
from calendar import monthrange
from datetime import date

# ---- 业务常量 ----
TRACKING_YEARS = 2            # 复壮措施完成后的跟踪年限
FOLLOWUP_INTERVAL_MONTHS = 6  # 跟踪记录的最大间隔（超期即提醒）

LEVELS = ["一级古树", "二级古树", "三级古树", "名木"]
TREE_STATUS = ["存活", "死亡", "迁移"]
CONCLUSIONS = ["健康", "基本健康", "衰弱", "濒危"]
MEASURE_TYPES = ["土壤改良", "施肥复壮", "病虫害防治", "树洞修补",
                 "支撑加固", "修剪整形", "根系复壮", "围栏保护", "其他"]
SURVIVALS = ["存活", "衰弱", "死亡"]


def parse_date(s):
    """解析 YYYY-MM-DD，无效返回 None。"""
    if not s:
        return None
    try:
        return date.fromisoformat(str(s).strip())
    except ValueError:
        return None


def add_months(d, months):
    """日期加减月份，月末日期自动回退（如 1/31 + 1月 → 2/28）。"""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, monthrange(y, m)[1]))


def months_between(a, b):
    """a 到 b 的整月数（b < a 时返回 0）。"""
    if b < a:
        return 0
    n = (b.year - a.year) * 12 + b.month - a.month
    if b.day < a.day:
        n -= 1
    return n


def tracking_status(treatments, followups, today=None):
    """根据一株古树的复壮措施与跟踪记录，计算当前跟踪状态。

    规则：
      - 以最近一次复壮措施的完成日期（无完成日期则用开始日期）起算两年跟踪期；
      - 跟踪期内每 6 个月至少应有一条跟踪记录，否则视为待跟踪；
      - 跟踪期外不再提醒。

    返回字典：
      phase          no_treatment（未复壮）/ in_period（跟踪期内）/ expired（已期满）
      start          跟踪期起算日
      deadline       跟踪期截止日
      last_track     本跟踪期内最近一次跟踪日期（None 表示期内未跟踪）
      months_since   距上次跟踪的整月数（None 表示期内未跟踪）
      next_due       下次建议跟踪日期
      needs_followup 是否需要尽快登记跟踪记录
      survival       全部跟踪记录中最近的存活状态（无记录为 None）
    """
    today = today or date.today()

    starts = []
    for t in treatments:
        d = parse_date(t["end_date"]) or parse_date(t["start_date"])
        if d:
            starts.append(d)

    tracks = sorted(
        (f for f in followups if parse_date(f["track_date"])),
        key=lambda f: f["track_date"],
    )
    survival = tracks[-1]["survival"] if tracks else None

    if not starts:
        return {"phase": "no_treatment", "survival": survival}

    start = max(starts)
    deadline = add_months(start, TRACKING_YEARS * 12)
    in_tracks = [f for f in tracks if parse_date(f["track_date"]) >= start]
    last_track = parse_date(in_tracks[-1]["track_date"]) if in_tracks else None
    months_since = months_between(last_track, today) if last_track else None
    next_due = add_months(last_track or start, FOLLOWUP_INTERVAL_MONTHS)
    phase = "in_period" if today <= deadline else "expired"
    needs = phase == "in_period" and (last_track is None or today > next_due)

    return {
        "phase": phase,
        "start": start,
        "deadline": deadline,
        "last_track": last_track,
        "months_since": months_since,
        "next_due": next_due,
        "needs_followup": needs,
        "survival": survival,
    }
