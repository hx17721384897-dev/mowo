-- One approved aftersale can be received only once, and can create only one replacement task.
CREATE UNIQUE INDEX `inventory_return_receipts_aftersale_request_id_key`
  ON `inventory_return_receipts`(`aftersale_request_id`);

CREATE UNIQUE INDEX `customize_orders_replacement_aftersale_unique`
  ON `customize_orders`(`replacement_for_id`, `aftersale_request_id`);
