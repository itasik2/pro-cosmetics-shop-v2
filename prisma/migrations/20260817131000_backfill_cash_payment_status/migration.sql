UPDATE "Order"
SET "paymentStatus" = 'DUE_ON_DELIVERY'
WHERE "paymentMethod" = 'CASH'
  AND "paymentStatus" = 'UNPAID';
