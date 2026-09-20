#!/usr/bin/env python3
"""写入演示数据，便于体验系统各状态（跟踪正常 / 待跟踪 / 跟踪期满 / 死亡 / 未复壮）。

用法：
    python3 seed.py           # 数据库为空时写入演示数据
    python3 seed.py --force   # 清空现有数据并重新写入
"""
import sys
from datetime import date

from app.db import connect, init_db
from app.domain import add_months

TREES = [
    # 编号, 树种, 拉丁名, 树龄, 级别, 地点, 权属/管护单位, 状态, 备注
    ("J-A0001", "银杏", "Ginkgo biloba", 550, "一级古树",
     "潭柘寺山门前", "市园林绿化局", "存活", "树冠东侧略偏冠"),
    ("J-A0002", "国槐", "Styphnolobium japonicum", 320, "二级古树",
     "中山公园来今雨轩旁", "公园管理处", "存活", ""),
    ("J-A0003", "侧柏", "Platycladus orientalis", 810, "一级古树",
     "天坛公园祈年殿东侧", "公园管理处", "存活", ""),
    ("J-B0001", "玉兰", "Yulania denudata", 120, "名木",
     "某中学老校区庭院", "学校后勤处", "存活", "名人手植"),
    ("J-A0004", "油松", "Pinus tabuliformis", 150, "三级古树",
     "香山公园见心斋", "公园管理处", "死亡", "2026 年确认枯死"),
    ("J-A0005", "刺槐", "Robinia pseudoacacia", 130, "三级古树",
     "植物园北园", "植物园管理处", "存活", ""),
]


def months_ago(n):
    return add_months(date.today(), -n).isoformat()


def main():
    init_db()
    conn = connect()
    try:
        count = conn.execute("SELECT COUNT(*) FROM trees").fetchone()[0]
        if count:
            if "--force" not in sys.argv:
                print("数据库已有 %d 株古树档案，未做改动。" % count)
                print("如需重置为演示数据：python3 seed.py --force")
                return
            for t in ("followups", "treatments", "checkups", "trees"):
                conn.execute("DELETE FROM %s" % t)

        ids = {}
        for code, name, latin, age, level, loc, owner, status, remark in TREES:
            cur = conn.execute(
                "INSERT INTO trees (code,name,latin_name,age,level,location,"
                "owner,status,remark) VALUES (?,?,?,?,?,?,?,?,?)",
                (code, name, latin, age, level, loc, owner, status, remark))
            ids[code] = cur.lastrowid

        def ck(code, ago, conclusion, trunk="", crown="", root="", pest="",
               suggestion="", examiner="市古树名木体检中心"):
            conn.execute(
                "INSERT INTO checkups (tree_id,check_date,conclusion,trunk,"
                "crown,root,pest,suggestion,examiner) VALUES (?,?,?,?,?,?,?,?,?)",
                (ids[code], months_ago(ago), conclusion, trunk, crown, root,
                 pest, suggestion, examiner))

        def tr(code, mtype, content, start_ago, end_ago,
               executor="区园林绿化养护公司"):
            conn.execute(
                "INSERT INTO treatments (tree_id,measure_type,content,"
                "start_date,end_date,executor) VALUES (?,?,?,?,?,?)",
                (ids[code], mtype, content, months_ago(start_ago),
                 months_ago(end_ago), executor))

        def fu(code, ago, survival, desc="", recorder=""):
            conn.execute(
                "INSERT INTO followups (tree_id,track_date,survival,"
                "growth_desc,recorder) VALUES (?,?,?,?,?)",
                (ids[code], months_ago(ago), survival, desc, recorder))

        # J-A0001 银杏：复壮完成 15 个月前，上次跟踪 7 个月前 → 待跟踪（超期）
        ck("J-A0001", 16, "衰弱", trunk="主干基部空洞约 30cm，局部腐朽",
           crown="枯枝约 15%，东侧偏冠", root="根际土壤板结",
           pest="未见明显病虫害", suggestion="树洞修补、土壤改良、设围栏")
        tr("J-A0001", "树洞修补", "清腐消毒后填充并封口，外围设保护围栏", 16, 15)
        tr("J-A0001", "土壤改良", "根际换填透气营养土，覆盖树皮", 16, 15)
        fu("J-A0001", 13, "存活", "新梢生长一般，叶色正常", "张明")
        fu("J-A0001", 7, "存活", "树冠枯枝未扩展", "张明")

        # J-A0002 国槐：跟踪期内，记录正常
        ck("J-A0002", 9, "基本健康", crown="少量枯枝", suggestion="秋季施肥复壮")
        tr("J-A0002", "施肥复壮", "环状沟施有机肥 200kg，浇透水", 9, 8)
        fu("J-A0002", 2, "存活", "长势良好，叶片浓绿", "李华")

        # J-A0003 侧柏：复壮完成 25 个月前 → 两年跟踪期已满
        ck("J-A0003", 26, "衰弱", trunk="主干倾斜约 8°", suggestion="支撑加固、根系复壮")
        tr("J-A0003", "支撑加固", "钢管三角支撑，树干接触处加橡胶垫", 26, 25)
        fu("J-A0003", 24, "存活", "支撑稳固", "王工")
        fu("J-A0003", 18, "存活", "生长正常", "王工")
        fu("J-A0003", 13, "存活", "生长正常，期满前最后一次跟踪", "王工")

        # J-B0001 玉兰：复壮完成 3 个月前，期内尚未跟踪 → 待跟踪（未跟踪）
        ck("J-B0001", 4, "濒危", pest="天牛蛀干危害", crown="冠幅萎缩明显",
           suggestion="紧急防治天牛，辅以施肥")
        tr("J-B0001", "病虫害防治", "树干注药防治天牛，根部施肥", 4, 3)

        # J-A0004 油松：跟踪期内死亡
        ck("J-A0004", 11, "濒危", pest="松材线虫疑似", suggestion="隔离防治")
        tr("J-A0004", "病虫害防治", "树干注射药剂，清除病弱枝", 11, 10)
        fu("J-A0004", 8, "衰弱", "针叶发黄脱落过半", "赵磊")
        fu("J-A0004", 4, "死亡", "全株枯死，确认死亡", "赵磊")

        # J-A0005 刺槐：仅体检，未复壮
        ck("J-A0005", 1, "健康", suggestion="常规养护，持续观察")

        conn.commit()
        print("演示数据已写入：%d 株古树档案（含体检、复壮措施与跟踪记录）。" % len(ids))
        print("覆盖状态：跟踪正常 / 待跟踪（超期与未跟踪）/ 跟踪期满 / 死亡 / 未复壮。")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
