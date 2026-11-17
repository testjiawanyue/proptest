import json
import re
from pathlib import Path

root = Path(r'E:\proptest')
spec_root = root / 'spec9-29' / 'spec' / 'docs' / 'features'
output_path = root / '_v4_build' / 'v5_cases.json'

targets = [
    {'feat': 'FEAT-01-customer', 'vals': ['VAL-06b'], 'module': '客户管理', 'category': '数据流'},
    {'feat': 'FEAT-03-base-data', 'vals': ['VAL-02b'], 'module': '基础设置', 'category': '边界值'},
    {'feat': 'FEAT-04-work-options', 'vals': ['VAL-02a', 'VAL-02c'], 'module': '基础设置', 'category': '边界值'},
    {'feat': 'FEAT-05-intake', 'vals': ['VAL-06', 'VAL-23', 'VAL-24'], 'module': '产品生产', 'category': '业务流'},
    {'feat': 'FEAT-06-assembly', 'vals': ['VAL-23', 'VAL-24'], 'module': '产品生产', 'category': '业务流'},
    {'feat': 'FEAT-08-product', 'vals': ['VAL-25', 'VAL-27'], 'module': '产品管理', 'category': '业务流'},
    {'feat': 'FEAT-09-part-tracing', 'vals': ['VAL-05'], 'module': '产品管理', 'category': '业务流'},
    {'feat': 'FEAT-10-order', 'vals': ['VAL-01', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-10', 'VAL-13', 'VAL-17', 'VAL-19', 'VAL-23', 'VAL-25', 'VAL-26'], 'module': '订单管理', 'category': '业务流'},
    {'feat': 'FEAT-11-shipment', 'vals': ['VAL-10', 'VAL-23'], 'module': '订单管理', 'category': '业务流'},
    {'feat': 'FEAT-12-periodic', 'vals': ['VAL-04', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-12', 'VAL-13', 'VAL-14', 'VAL-15', 'VAL-16', 'VAL-17', 'VAL-18', 'VAL-34', 'VAL-40'], 'module': '点检管理', 'category': '业务流'},
    {'feat': 'FEAT-13-notice', 'vals': ['VAL-30', 'VAL-35'], 'module': '点检管理', 'category': '数据流'},
    {'feat': 'FEAT-15-reception-history', 'vals': ['VAL-27', 'VAL-28', 'VAL-34', 'VAL-35', 'VAL-38'], 'module': '受付工作台', 'category': '业务流'},
    {'feat': 'FEAT-17-return', 'vals': ['VAL-01'], 'module': '作业管理', 'category': '显示'},
    {'feat': 'FEAT-18-return-batch-print', 'vals': ['VAL-01'], 'module': '作业管理', 'category': '显示'},
]

pre_by_feat = {
    'FEAT-01-customer': '已存在多个客户、支店/现场和联系人数据，管理员账号可登录。',
    'FEAT-03-base-data': '管理员账号可登录，基础数据页可访问。',
    'FEAT-04-work-options': '管理员账号可登录，作业选项维护页可访问。',
    'FEAT-05-intake': '管理员账号可登录，衣体入库页可访问。',
    'FEAT-06-assembly': '已存在可组装产品和默认部件资料，管理员账号可登录。',
    'FEAT-08-product': '已存在产品、部件及相关业务履历，管理员账号可登录。',
    'FEAT-09-part-tracing': '已存在部件档案和业务履历，管理员账号可登录。',
    'FEAT-10-order': '已存在不同状态的订单和产品，管理员账号可登录。',
    'FEAT-11-shipment': '已存在订单、产品和寄送数据，管理员账号可登录。',
    'FEAT-12-periodic': '已存在月度候选产品和客户关系，管理员账号可登录。',
    'FEAT-13-notice': '已存在通知和受付数据，管理员账号可登录。',
    'FEAT-15-reception-history': '已存在受付历史和批次数据，管理员账号可登录。',
    'FEAT-17-return': '已存在待返送和已返送数据，管理员账号可登录。',
    'FEAT-18-return-batch-print': '已存在准备中的返送面单，管理员账号可登录。',
}


def parse_sections(path: Path):
    text = path.read_text(encoding='utf-8')
    sections = {}
    pattern = r'(?ms)^### (VAL-[^\s]+)\s+([^\n]+)\n(.*?)(?=^### |\Z)'
    for match in re.finditer(pattern, text):
        code = match.group(1).strip()
        title = re.sub(r'（spec[^）]*）$', '', match.group(2).strip()).strip()
        body = match.group(3).strip()
        sections[code] = (title, body)
    return sections


cases = []
for target in targets:
    feat = target['feat']
    sections = parse_sections(spec_root / feat / 'validation.md')
    feat_number = int(re.search(r'FEAT-(\d+)', feat).group(1))
    for val in target['vals']:
        title, body = sections[val]
        if '预期：' in body:
            operation, expected = body.split('预期：', 1)
        else:
            operation, expected = body, '按验收规则确认结果。'
        operation = re.sub(r'^>\s*', '', operation, flags=re.M).strip()
        expected = expected.strip()
        cases.append({
            'id': f'V5-{len(cases) + 1:03d}',
            'section': f"V5缺口补充/{target['module']}",
            'title': title,
            'point': title,
            'pre': pre_by_feat[feat],
            'steps': operation,
            'expect': expected,
            'feats': [feat_number],
            'vals': [val],
            'category': target['category'],
            'source': f'{feat}/validation.md {val}',
        })

output_path.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'生成 {len(cases)} 条 V5 补充用例：{output_path}')
