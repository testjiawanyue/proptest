"""Unique data for data-writing UI flows."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4


def _bearer_token_from_page(page) -> str:
    """从浏览器 cookie 中提取 Admin-Token（后端 JWT 鉴权）。"""
    ctx = page.context
    for c in ctx.cookies():
        if c["name"] == "Admin-Token":
            return c["value"]
    return ""


def ensure_seed_data(page, base_url: str) -> None:
    """Ensure required seed part profiles exist and are enabled.

    后端 seed data（PTG jacket）是所有生产测试的前置依赖。
    后端用 ``Authorization: Bearer <JWT>`` header 鉴权（JWT 存在 Admin-Token cookie 里），
    纯 fetch ``credentials: "include"`` 只带 cookie，不会自动加 Authorization header，
    因此所有 API 都返回 401。这里显式补上 header。
    """
    token = _bearer_token_from_page(page)
    auth = f"Bearer {token}" if token else ""

    MASTER = production_master_data()
    required = [("jacket", MASTER.jacket_prefix, "SEED-PTG")]

    for part_type, prefix, name in required:
        # 1) 查询：带 Authorization header，看 PTG 是否已存在
        has = page.evaluate(
            f"""
            async () => {{
                const r = await fetch(
                    "{base_url}/dev-api/prop/part-profile/enabled/{part_type}",
                    {{
                        credentials: "include",
                        headers: {{ "Authorization": "{auth}" }}
                    }}
                );
                const d = await r.json();
                return (d.data || []).some(it => String(it.numberPrefix) === "{prefix}");
            }}
            """
        )
        if has:
            continue

        # 2) 不存在 → 创建；即使"同種別同品名既に登録"也视为成功（PTG 已存在但非 enabled 状态）
        page.evaluate(
            f"""
            async () => {{
                try {{
                    await fetch("{base_url}/dev-api/prop/part-profile", {{
                        method: "POST",
                        credentials: "include",
                        headers: {{
                            "Content-Type": "application/json",
                            "Authorization": "{auth}"
                        }},
                        body: JSON.stringify({{
                            partType: "{part_type}",
                            partName: "{name} 衣体",
                            specification: "{name}",
                            manufacturer: "SEED",
                            numberPrefix: "{prefix}",
                        }}),
                    }});
                }} catch(e) {{}}
            }}
            """
        )
        # 3) 后置验证
        page.wait_for_timeout(300)
        now_exists = page.evaluate(
            f"""
            async () => {{
                const r = await fetch(
                    "{base_url}/dev-api/prop/part-profile/enabled/{part_type}",
                    {{
                        credentials: "include",
                        headers: {{ "Authorization": "{auth}" }}
                    }}
                );
                const d = await r.json();
                return (d.data || []).some(it => String(it.numberPrefix) === "{prefix}");
            }}
            """
        )
        if not now_exists:
            raise RuntimeError(
                f"ensure_seed_data: {part_type}/{prefix} を作成できませんでした。"
                f"バックエンド seed data を確認してください。"
            )


@dataclass(frozen=True)
class PartProfileData:
    part_name: str
    specification: str
    manufacturer: str
    number_prefix: str


@dataclass(frozen=True)
class ValueData:
    value: str


@dataclass(frozen=True)
class CustomerData:
    company_name: str
    branch_name: str
    postal: str
    address1: str
    address2: str
    branch_postal: str
    branch_address1: str
    contact_name: str
    branch_contact_name: str
    title: str
    phone: str
    fax: str
    email: str
    note: str
    branch_phone: str
    storage_path: str


@dataclass(frozen=True)
class OrderData:
    customer_order_no: str
    color_note: str
    remark: str


@dataclass(frozen=True)
class ProductionChainData:
    master: "ProductionMasterData"
    number_start: str
    number_end: str
    products: tuple["ProductionProduct", ...]

    @property
    def numbers(self) -> tuple[str, ...]:
        return tuple(product.number for product in self.products)

    @property
    def eligible_products(self) -> tuple["ProductionProduct", ...]:
        return tuple(product for product in self.products if product.required_complete)

    @property
    def ineligible_products(self) -> tuple["ProductionProduct", ...]:
        return tuple(product for product in self.products if not product.required_complete)

    @property
    def complete_required_count(self) -> int:
        return len(self.eligible_products)


@dataclass(frozen=True)
class ProductionMasterData:
    """生产用例依赖的基础主数据，可通过环境变量覆盖。"""

    jacket_prefix: str
    airbag_profile: str
    sensor_profile: str
    firmware: str
    inflator_profile: str


@dataclass(frozen=True)
class ProductionPart:
    slot: str
    column: int
    suffix: str


@dataclass(frozen=True)
class ProductionProduct:
    number: str
    parts: tuple[ProductionPart, ...]

    def part(self, slot: str) -> ProductionPart | None:
        return next((part for part in self.parts if part.slot == slot), None)

    @property
    def required_complete(self) -> bool:
        slots = {part.slot for part in self.parts}
        return {"airbag", "sensor", "inflator_1"} <= slots


def _unique_token() -> str:
    return f"{datetime.now():%Y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


def part_profile_data() -> PartProfileData:
    token = _unique_token()
    # 番号の接頭辞は 同じ部品種別 内で一意（無効含む）。
    number_prefix = f"AWP{token[-4:]}"
    return PartProfileData(
        part_name=f"AUTO-WA-PART-{token}",
        specification=f"AUTO-WA-SPEC-{token}",
        manufacturer="AUTO-WA-MAKER",
        number_prefix=number_prefix,
    )


def firmware_version_data() -> ValueData:
    return ValueData(value=f"AUTO-WA-FW-{_unique_token()}")


def work_option_data() -> ValueData:
    return ValueData(value=f"AUTO-WA-WO-{_unique_token()}")


def customer_data() -> CustomerData:
    token = _unique_token()
    prefix = f"AUTO-WA-CUST-{token}"
    return CustomerData(
        company_name=prefix,
        branch_name=f"{prefix}-BR",
        postal="1040033",
        address1="東京都中央区銀座1-1-1",
        address2="AUTOビル3F",
        branch_postal="1040034",
        branch_address1="東京都中央区銀座2-2-2",
        contact_name=f"{prefix}-PIC",
        branch_contact_name=f"{prefix}-BR-PIC",
        title="物流部 部長",
        phone="03-1234-5678",
        fax="03-1234-5679",
        email="auto-wa@example.com",
        note="Web自动化测试数据",
        branch_phone="03-9876-5432",
        storage_path=f"\\\\nas\\customer\\{prefix}",
    )


def order_data() -> OrderData:
    token = _unique_token()
    return OrderData(
        customer_order_no=f"AUTO-WA-ORD-{token}",
        color_note=f"AUTO-WA-COLOR-{token[-4:]}",
        remark="Web自动化测试数据",
    )


def production_master_data() -> ProductionMasterData:
    master = ProductionMasterData(
        jacket_prefix=os.getenv("WEBTEST_PROD_JACKET_PREFIX", "PTG"),
        airbag_profile=os.getenv("WEBTEST_PROD_AIRBAG_PROFILE", "气囊 A型"),
        sensor_profile=os.getenv("WEBTEST_PROD_SENSOR_PROFILE", "传感器 A型"),
        firmware=os.getenv("WEBTEST_PROD_FIRMWARE", "85cm"),
        inflator_profile=os.getenv("WEBTEST_PROD_INFLATOR_PROFILE", "充气发生器 A型"),
    )
    if not all(
        [
            master.jacket_prefix,
            master.airbag_profile,
            master.sensor_profile,
            master.firmware,
            master.inflator_profile,
        ]
    ):
        raise ValueError("生产主数据配置不能为空")
    return master


def production_chain_data(master: ProductionMasterData | None = None) -> ProductionChainData:
    master = master or production_master_data()
    token = f"{datetime.now():%H%M%S}{uuid4().int % 90 + 10}"
    start = int(token)
    part_base = f"{start % 10_000_000:07d}"
    numbers = (
        f"{master.jacket_prefix}{start:08d}",
        f"{master.jacket_prefix}{start + 1:08d}",
        f"{master.jacket_prefix}{start + 2:08d}",
    )
    products = (
        ProductionProduct(
            numbers[0],
            (
                ProductionPart("airbag", 0, f"{part_base}01"),
                ProductionPart("sensor", 1, f"{part_base}02"),
                ProductionPart("inflator_1", 2, f"{part_base}03"),
            ),
        ),
        ProductionProduct(
            numbers[1],
            (
                ProductionPart("airbag", 0, f"{part_base}04"),
                ProductionPart("sensor", 1, f"{part_base}05"),
                ProductionPart("inflator_1", 2, f"{part_base}06"),
                ProductionPart("inflator_2", 3, f"{part_base}07"),
            ),
        ),
        ProductionProduct(
            numbers[2],
            (ProductionPart("airbag", 0, f"{part_base}08"),),
        ),
    )
    return ProductionChainData(
        master=master,
        number_start=f"{start:08d}",
        number_end=f"{start + 2:08d}",
        products=products,
    )
