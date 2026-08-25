BEGIN;

-- The initial multi-instance dispatch proof intentionally persisted one synthetic
-- unknown settlement. Retire only records carrying the reserved verification prefix;
-- preserve every row as evidence and move the attempt/order to valid terminal states.
UPDATE desky_commerce.payment_attempts
SET payload_text = ((payload_text::jsonb) || '{"state":"failed"}'::jsonb)::text
WHERE attempt_id LIKE 'attempt:verification:%'
  AND payload_text LIKE '%"state":"settlement-unknown"%';

UPDATE desky_commerce.commerce_orders
SET payload_text = ((payload_text::jsonb) || '{"state":"cancelled"}'::jsonb)::text
WHERE order_id LIKE 'order:verification:%'
  AND payload_text LIKE '%"state":"awaiting-settlement"%';

COMMIT;
