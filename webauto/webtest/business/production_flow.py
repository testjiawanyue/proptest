"""产品生产主流程辅助：为各页面用例准备前置数据。"""

from __future__ import annotations

from business.base_flow import BaseFlow
from common.antd import wait_for_feedback
from data.factory import ProductionChainData, ensure_seed_data
from pages.production_assembly_page import ProductionAssemblyPage
from pages.production_inspection_page import ProductionInspectionPage
from pages.production_intake_page import ProductionIntakePage


class ProductionFlow(BaseFlow):
    def intake_products(self, data: ProductionChainData) -> ProductionIntakePage:
        ensure_seed_data(self.page, self.settings.base_url)
        page = ProductionIntakePage(self.page, self.settings).open()
        page.select_jacket(data.master.jacket_prefix)
        page.add_range(data.number_start, data.number_end)
        page.wait_for_candidate_count(len(data.products))
        page.confirm_all()
        page.wait_for_candidate_count(0)
        return page

    def assemble_products(self, data: ProductionChainData) -> ProductionAssemblyPage:
        page = ProductionAssemblyPage(self.page, self.settings).open()
        page.select_jacket(data.master.jacket_prefix)
        page.set_defaults(
            airbag=data.master.airbag_profile,
            sensor=data.master.sensor_profile,
            firmware=data.master.firmware,
            inflator=data.master.inflator_profile,
        )
        page.search_range(data.number_start, data.number_end)
        for product in data.products:
            for part in product.parts:
                page.save_cell(product.number, part.column, part.suffix)
        return page

    def inspect_products(self, data: ProductionChainData) -> ProductionInspectionPage:
        page = ProductionInspectionPage(self.page, self.settings).open()
        page.select_prefix(data.master.jacket_prefix)
        page.filter_range(data.number_start, data.number_end)
        eligible = data.eligible_products
        for product in eligible:
            page.select_row(product.number)
        page.confirm()
        wait_for_feedback(self.page, f"成功 {len(eligible)}台、失敗 0台")
        return page

    def prepare_inspected_products(self, data: ProductionChainData) -> ProductionInspectionPage:
        """准备一条可被产品列表和部件追溯复用的已质检生产链。"""
        # 前置：确保后端 seed data（PTG jacket 等）存在
        ensure_seed_data(self.page, self.settings.base_url)
        self.intake_products(data)
        self.assemble_products(data)
        return self.inspect_products(data)
