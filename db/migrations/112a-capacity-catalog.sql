-- Operations reference the catalog by SKU. available=false keeps add-ons out of the checkout path; they are sold only as subscription items.
ALTER TABLE app.billing_catalog DROP CONSTRAINT billing_catalog_kind_check;
ALTER TABLE app.billing_catalog ADD CONSTRAINT billing_catalog_kind_check CHECK(kind IN('plan','pack','capacity'));
INSERT INTO app.billing_catalog(sku,version,kind,amount,currency,allowances,capacity,available) VALUES
 ('capacity-mailboxes','2026-10-24-v1','capacity',1900,'brl','{}','{}',false),
 ('capacity-whatsapp','2026-10-24-v1','capacity',4900,'brl','{}','{}',false),
 ('capacity-seats','2026-10-24-v1','capacity',5900,'brl','{}','{}',false),
 ('capacity-mailboxes-annual','2026-10-24-v1','capacity',22800,'brl','{}','{}',false),
 ('capacity-whatsapp-annual','2026-10-24-v1','capacity',58800,'brl','{}','{}',false),
 ('capacity-seats-annual','2026-10-24-v1','capacity',70800,'brl','{}','{}',false);
