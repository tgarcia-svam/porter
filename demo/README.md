# Porter Demo Materials: Commercial Customer Reporting

**Scenario.** *Summit Industrial Supply* (fictional) is a wholesale supplier of fasteners, power tools,
safety equipment, electrical and plumbing products. Its commercial customers (distributors and contractor
chains) must report to Summit every month and quarter. Today that arrives as emailed spreadsheets with
mismatched columns. Porter replaces it with one secure upload point that checks every file instantly.

All names, IDs and numbers are fictional. No real customer data.

## Organizations (the data providers)

Create these four organizations and assign **all four to both projects**:

| Organization | Customer ID | Region |
|---|---|---|
| Apex Contractor Supply | CUS-10021 | Northeast |
| Blue Ridge Distribution | CUS-10047 | Southeast |
| Lakeshore Building Products | CUS-10063 | Midwest |
| Pacific Trade Partners | CUS-10088 | West |

Create one uploader user per organization (for the demo, use the Apex user for the live upload).

---

## Project 1: Monthly Sales & Inventory Reporting

*Description:* "Monthly sell-through and on-hand inventory from each commercial customer."
*Schedule:* Monthly, due on the 5th, reminder 3 days before, overdue email on.

### File format 1: Sell-Through Report (`Sell-Through Report`)

| Column | Type | Required | Rule (classification) |
|---|---|---|---|
| order_date | DATE | Yes | Date range 2026-01-01 to 2026-12-31 |
| customer_id | TEXT | Yes | Regex `^CUS-\d{5}$` (hint: "Format CUS-12345") |
| location_name | TEXT | Yes | none |
| sku | TEXT | Yes | Regex `^[A-Z]{3}-\d{4}$` (hint: "Format ABC-1234") |
| product_category | TEXT | Yes | Value list: Fasteners, Power Tools, Safety Equipment, Electrical, Plumbing |
| units_sold | INTEGER | Yes | Number range 0 to 100000 |
| unit_price | NUMBER | Yes | Number range 0.01 to 50000 |
| net_revenue | NUMBER | Yes | none |
| region | TEXT | Yes | Value list: Northeast, Southeast, Midwest, Southwest, West |
| contact_email | EMAIL | No | none |

*Visualizations:* Indicator (SUM net_revenue, "Total Net Revenue"); Bar (SUM net_revenue by product_category,
"Revenue by Category"); Line (SUM net_revenue by order_date, granularity DAY, "Daily Revenue").

### File format 2: Inventory Snapshot (`Inventory Snapshot`)

| Column | Type | Required | Rule (classification) |
|---|---|---|---|
| snapshot_date | DATE | Yes | Date range 2026-01-01 to 2026-12-31 |
| customer_id | TEXT | Yes | Regex `^CUS-\d{5}$` |
| warehouse_id | TEXT | Yes | Regex `^WH-\d{3}$` (hint: "Format WH-101") |
| sku | TEXT | Yes | Regex `^[A-Z]{3}-\d{4}$` |
| units_on_hand | INTEGER | Yes | Number range 0 to 1000000 |
| units_on_order | INTEGER | Yes | Number range 0 to 1000000 |
| reorder_point | INTEGER | Yes | Number range 0 to 1000000 |
| last_received_date | DATE | Yes | none |
| backordered | BOOLEAN | Yes | none |

*Column comparison:* `last_received_date` <= `snapshot_date`.
*Visualizations:* Indicator (SUM units_on_hand, "Units On Hand"); Bar (SUM units_on_hand by warehouse_id,
"Stock by Warehouse").

---

## Project 2: Quarterly Accounts & Contract Compliance

*Description:* "Quarterly receivables and contract pricing reported by each commercial customer."
*Schedule:* Quarterly, due the 15th of the first month of the quarter, reminder 7 days before, overdue email on.

### File format 3: Receivables Aging (`Receivables Aging`)

| Column | Type | Required | Rule (classification) |
|---|---|---|---|
| as_of_date | DATE | Yes | Date range 2026-01-01 to 2026-12-31 |
| customer_id | TEXT | Yes | Regex `^CUS-\d{5}$` |
| invoice_number | TEXT | Yes | Regex `^INV-\d{6}$` (hint: "Format INV-004512") |
| invoice_date | DATE | Yes | none |
| due_date | DATE | Yes | none |
| invoice_amount | NUMBER | Yes | Number range 0.01 to 10000000 |
| open_balance | NUMBER | Yes | Number range 0 to 10000000 |
| aging_bucket | TEXT | Yes | Value list: Current, 1-30, 31-60, 61-90, 90+ |
| billing_contact | EMAIL | Yes | none |
| disputed | BOOLEAN | Yes | none |

*Column comparisons:* `invoice_date` <= `due_date`; `open_balance` <= `invoice_amount`.
*Visualizations:* Indicator (SUM open_balance, "Total Open Balance"); Bar (SUM open_balance by aging_bucket,
"Balance by Aging Bucket").

### File format 4: Contract Pricing Compliance (`Contract Pricing`)

| Column | Type | Required | Rule (classification) |
|---|---|---|---|
| quarter_end | DATE | Yes | Date range 2026-01-01 to 2026-12-31 |
| customer_id | TEXT | Yes | Regex `^CUS-\d{5}$` |
| contract_id | TEXT | Yes | Regex `^CTR-\d{4}$` (hint: "Format CTR-2041") |
| sku | TEXT | Yes | Regex `^[A-Z]{3}-\d{4}$` |
| pricing_tier | TEXT | Yes | Value list: Standard, Silver, Gold, Platinum |
| contract_price | NUMBER | Yes | Number range 0.01 to 50000 |
| price_paid | NUMBER | Yes | Number range 0.01 to 50000 |
| quantity | INTEGER | Yes | Number range 1 to 1000000 |
| rebate_eligible | BOOLEAN | Yes | none |

*Visualizations:* Indicator (SUM quantity, "Units Under Contract"); Bar (SUM quantity by pricing_tier,
"Volume by Pricing Tier").

---

## Sample files (`demo/data/`)

| File | Format | Expected result |
|---|---|---|
| `sell-through_valid.csv` | Sell-Through Report | VALID (12 rows) |
| `sell-through_errors.csv` | Sell-Through Report | INVALID: 4 problems (use for the "pinpointed errors" scene) |
| `inventory_valid.csv` | Inventory Snapshot | VALID (10 rows) |
| `receivables_valid.csv` | Receivables Aging | VALID (10 rows) |
| `receivables_errors.csv` | Receivables Aging | INVALID: 3 problems (backup error scene) |
| `contract-pricing_valid.csv` | Contract Pricing | VALID (10 rows) |

### Errors planted in `sell-through_errors.csv`

| Row | Column | Problem |
|---|---|---|
| 3 | sku | `HX4410` does not match the required format ABC-1234 |
| 5 | product_category | `Hardware` is not a recognised value |
| 7 | units_sold | `twelve` is not a valid integer |
| 9 | order_date | `2027-03-14` is outside the allowed date range |

### Errors planted in `receivables_errors.csv`

| Row | Column | Problem |
|---|---|---|
| 3 | open_balance | `9800.00` exceeds invoice_amount `7250.00` (comparison rule) |
| 5 | invoice_number | `INV-4512` does not match the required format INV-004512 |
| 8 | billing_contact | `accounts-payable.lakeshore.com` is not a valid email |

Row numbers count the header as row 1. Exact wording of messages comes from the app; check against the build you record.

## Suggested demo flow (2 minutes)

1. Admin view: show Project 1 with its two file formats and the monthly schedule.
2. Sign in as the Apex uploader. Upload `sell-through_errors.csv` and pause on the pinpointed errors.
3. Upload `sell-through_valid.csv` and show VALID.
4. Admin Analytics: pick Project 1, then Sell-Through Report, and filter by organization.
5. Show Project 2 briefly (Receivables Aging with its comparison rules) and the schedule/reminder email.

Seed a few extra VALID uploads from the other organizations beforehand so the analytics charts show several providers.
