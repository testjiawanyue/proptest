from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

NAVY = "#17324D"
TEAL = "#1F7A8C"
BLUE = "#DCEBF1"
LIGHT = "#F5F8FA"
ORANGE = "#C26A2E"
GRAY = "#66727D"
WHITE = "#FFFFFF"


def font(size: int, bold: bool = False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def centered_text(draw, box, text, text_font, fill=WHITE, spacing=6):
    x1, y1, x2, y2 = box
    lines = text.split("\n")
    heights = []
    widths = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=text_font)
        widths.append(bbox[2] - bbox[0])
        heights.append(bbox[3] - bbox[1])
    total_h = sum(heights) + spacing * (len(lines) - 1)
    y = y1 + (y2 - y1 - total_h) / 2
    for line, w, h in zip(lines, widths, heights):
        draw.text((x1 + (x2 - x1 - w) / 2, y - 2), line, font=text_font, fill=fill)
        y += h + spacing


def arrow(draw, start, end, color=GRAY, width=4):
    draw.line([start, end], fill=color, width=width)
    x1, y1 = start
    x2, y2 = end
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        points = [(x2, y2), (x2 - 14 * direction, y2 - 8), (x2 - 14 * direction, y2 + 8)]
    else:
        direction = 1 if y2 > y1 else -1
        points = [(x2, y2), (x2 - 8, y2 - 14 * direction), (x2 + 8, y2 - 14 * direction)]
    draw.polygon(points, fill=color)


def build_flow():
    img = Image.new("RGB", (1600, 1000), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((70, 45), "质量保证全流程与主要介入点", font=font(46, True), fill=NAVY)
    draw.text((72, 108), "从需求准入到线上反馈，每个阶段都有明确输入、输出和门禁", font=font(24), fill=GRAY)

    stages = [
        ("S0", "任务准入", "Spec、风险\n验收条件", "需求冻结"),
        ("S1", "方案与契约", "接口、数据\n迁移与回滚", "契约评审"),
        ("S2", "AI 编码内环", "构建、类型\nLint、单测", "每次修改"),
        ("S3", "合并前验证", "契约、影响\n定向回归", "PR 门禁"),
        ("S4", "系统业务验证", "UI、API、DB\n人工裁定", "准出评审"),
        ("S5", "发布与灰度", "迁移、回滚\n监控与灰度", "发布门禁"),
        ("S6", "线上反馈", "缺陷、指标\n规则回流", "复盘改进"),
    ]

    left = 55
    top = 205
    box_w = 335
    gap = 30
    box_h = 235
    row_gap = 105
    positions = []
    for index, (sid, name, detail, marker) in enumerate(stages):
        row = 0 if index < 4 else 1
        col = index if row == 0 else index - 4
        x = left + col * (box_w + gap) + (55 if row == 1 else 0)
        y = top + row * (box_h + row_gap)
        positions.append((x, y))
        fill = NAVY if index in (0, 1, 2, 3) else TEAL
        draw.rounded_rectangle((x, y, x + box_w, y + box_h), radius=20, fill=fill)
        draw.text((x + 22, y + 18), sid, font=font(30, True), fill=WHITE)
        centered_text(draw, (x + 16, y + 60, x + box_w - 16, y + 108), name, font(24, True))
        centered_text(draw, (x + 18, y + 122, x + box_w - 18, y + 184), detail, font(19), fill="#EAF2F5", spacing=8)
        draw.rounded_rectangle((x + 40, y + 190, x + box_w - 40, y + 226), radius=12, fill="#F3E7DE", outline=ORANGE, width=2)
        centered_text(draw, (x + 44, y + 190, x + box_w - 44, y + 226), marker, font(17, True), fill=ORANGE)
        if row == 0 and index < 3:
            arrow(draw, (x + box_w + 5, y + box_h / 2), (x + box_w + gap - 5, y + box_h / 2), color=TEAL, width=4)
    for index in range(3):
        x1, y1 = positions[index + 4]
        if index < 2:
            arrow(draw, (x1 + box_w + 5, y1 + box_h / 2), (x1 + box_w + gap - 5, y1 + box_h / 2), color=TEAL, width=4)
    draw.line([(100, 490), (100, 535), (1530, 535), (1530, 585)], fill=ORANGE, width=4)
    arrow(draw, (1530, 560), (1530, 590), color=ORANGE, width=4)
    draw.text((70, 875), "最高杠杆介入点：需求冻结、契约设计、AI 编码内环、合并门禁", font=font(23, True), fill=ORANGE)
    img.save(ASSETS / "flow.png", quality=95)


def build_layers():
    img = Image.new("RGB", (1600, 1120), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((65, 45), "七层验证架构", font=font(46, True), fill=NAVY)
    draw.text((67, 105), "不同层级回答不同问题，任何单层通过都不能替代其他层", font=font(24), fill=GRAY)

    layers = [
        ("L6", "发布后观测", "灰度、监控、错误预算、自动回滚", "真实环境可靠性"),
        ("L5", "非功能与韧性", "权限、并发、性能、兼容、故障注入", "高风险专项结论"),
        ("L4", "业务与系统验证", "Playwright、网络探针、数据库探针、文件金样", "业务事实证据"),
        ("L3", "变更影响与回归", "Git 差异、调用关系、需求与用例映射", "影响范围与漏选分析"),
        ("L2", "契约与集成", "Schema、MockMvc、Testcontainers、事务断言", "接口与数据交互结论"),
        ("L1", "单元与组件", "JUnit、Mockito、Node Test、规则与状态机", "逻辑正确性证据"),
        ("L0", "工程与静态质量", "构建、类型、Lint、Secret、SCA、SAST", "可运行与安全底线"),
    ]

    top = 175
    height = 112
    gap = 15
    left = 65
    width = 1160
    for index, (lid, name, tools, result) in enumerate(layers):
        y = top + index * (height + gap)
        color = NAVY if lid in ("L0", "L1", "L2") else TEAL
        draw.rounded_rectangle((left, y, left + width, y + height), radius=18, fill=color)
        draw.text((left + 28, y + 27), lid, font=font(32, True), fill=WHITE)
        draw.text((left + 110, y + 16), name, font=font(25, True), fill=WHITE)
        draw.text((left + 110, y + 58), tools, font=font(17), fill="#DCEBF1")
        draw.rounded_rectangle((left + width + 24, y + 19, 1535, y + height - 19), radius=12, fill=LIGHT, outline="#CBD8DF", width=2)
        centered_text(draw, (left + width + 30, y + 19, 1529, y + height - 19), result, font(17, True), fill=NAVY)

    draw.text((300, 1040), "证据账本贯穿全部层级：提交号、环境、时间、结果、责任人和产物", font=font(21, True), fill=ORANGE)
    img.save(ASSETS / "layers.png", quality=95)


def build_degrade():
    img = Image.new("RGB", (1600, 900), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((65, 45), "质量体系降级与恢复状态", font=font(46, True), fill=NAVY)
    draw.text((67, 105), "降级不是关闭质量，而是缩小自动化范围并保留最低安全控制", font=font(24), fill=GRAY)

    states = [
        ("D0", "正常", "全部门禁\n按设计运行", TEAL),
        ("D1", "观察", "AI 与低置信度\n规则只告警", "#3D7E91"),
        ("D2", "核心优先", "只保留核心模块\n和核心链路", "#486C89"),
        ("D3", "人工兜底", "核心冒烟与\n人工审批", "#6B607C"),
        ("D4", "安全冻结", "暂停相关发布\n和自动写入", "#7B4B4B"),
    ]

    left = 55
    top = 220
    width = 260
    gap = 48
    height = 240
    for index, (sid, name, detail, color) in enumerate(states):
        x = left + index * (width + gap)
        draw.rounded_rectangle((x, top, x + width, top + height), radius=24, fill=color)
        draw.text((x + 22, top + 20), sid, font=font(32, True), fill=WHITE)
        centered_text(draw, (x + 14, top + 67, x + width - 14, top + 120), name, font(23, True))
        centered_text(draw, (x + 18, top + 132, x + width - 18, top + 210), detail, font(17), fill="#EDF3F5", spacing=7)
        if index < len(states) - 1:
            arrow(draw, (x + width + 6, top + height / 2), (x + width + gap - 6, top + height / 2), color=ORANGE, width=5)

    draw.rounded_rectangle((80, 585, 1520, 720), radius=18, fill="#F7F1EC", outline="#E5C3AA", width=2)
    draw.text((110, 612), "始终保留的安全底线", font=font(24, True), fill=ORANGE)
    draw.text((110, 660), "编译与构建 · Secret 扫描 · P0 权限检查 · 数据库迁移校验 · 备份与回滚 · 人工紧急审批", font=font(18), fill=NAVY)
    draw.text((80, 785), "恢复路径：D4 → D3 → D2 → D1 → D0，逐级恢复，不能跳级。", font=font(21, True), fill=GRAY)
    img.save(ASSETS / "degrade.png", quality=95)


if __name__ == "__main__":
    build_flow()
    build_layers()
    build_degrade()
    print("已生成流程、分层和降级图。")
