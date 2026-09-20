"""HTML 输出工具。"""
from html import escape


def h(value):
    """HTML 转义，None 转为空串。所有用户数据输出前都必须经过此函数。"""
    return escape("" if value is None else str(value), quote=True)
