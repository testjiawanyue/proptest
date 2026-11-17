"""订单与寄送主流程编排：创建客户、创建订单、准备可打印寄送。"""

from __future__ import annotations

from dataclasses import dataclass, replace

from business.base_flow import BaseFlow
from data.factory import CustomerData, OrderData, ProductionChainData
from pages.customer_page import CustomerPage
from pages.order_detail_page import OrderDetailPage
from pages.order_form_page import OrderFormPage


@dataclass(frozen=True)
class OrderRecord:
    order_id: str
    order_no: str
    customer_order_no: str
    product_name: str
    shipment_no: str = ""
    product_numbers: tuple[str, ...] = ()


class OrderFlow(BaseFlow):
    def create_order(
        self,
        customer: CustomerData,
        order: OrderData,
        *,
        quantity: int,
        product_name: str | None = None,
    ) -> OrderRecord:
        CustomerPage(self.page, self.settings).open().create_company(customer)
        form = OrderFormPage(self.page, self.settings).open()
        form.select_ordering_customer(customer.company_name)
        form.expect_delivery_auto_selected(customer.address1)
        selected_name = product_name or form.choose_first_product_name()
        form.fill_order(
            customer_order_no=order.customer_order_no,
            color_note=order.color_note,
            quantity=quantity,
            remark=order.remark,
        )
        created = form.create()
        return OrderRecord(
            order_id=str(created["orderId"]),
            order_no=str(created["orderNo"]),
            customer_order_no=order.customer_order_no,
            product_name=selected_name,
        )

    def prepare_shipment(
        self,
        record: OrderRecord,
        production: ProductionChainData,
        *,
        carrier: str = "ヤマト運輸",
    ) -> OrderRecord:
        detail = OrderDetailPage(self.page, self.settings).open(record.order_id)
        drawer = detail.open_shipment_drawer()
        shipment_no = drawer.shipment_no()
        added: list[str] = []
        for product in production.eligible_products:
            added.extend(drawer.add_product_single(product.number))
        drawer.expect_products(tuple(added))
        drawer.select_carrier(carrier)
        drawer.close()
        return replace(
            record,
            shipment_no=shipment_no,
            product_numbers=tuple(added),
        )
