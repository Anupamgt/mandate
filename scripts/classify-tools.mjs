import { readFileSync, writeFileSync } from "node:fs";

const CLASS = {
  capture_payment: "MONEY_IN",
  create_order: "MONEY_IN",
  create_payment_link: "MONEY_IN",
  create_qr_code: "MONEY_IN",
  create_registration_link: "MONEY_IN",
  detect_stack: "READ",
  fetch_all_instant_settlements: "READ",
  fetch_all_orders: "READ",
  fetch_all_payment_links: "READ",
  fetch_all_payments: "READ",
  fetch_all_payouts: "READ",
  fetch_all_qr_codes: "READ",
  fetch_all_refunds: "READ",
  fetch_all_settlements: "READ",
  fetch_instant_settlement_with_id: "READ",
  fetch_multiple_refunds_for_payment: "READ",
  fetch_order: "READ",
  fetch_order_payments: "READ",
  fetch_payment: "READ",
  fetch_payment_card_details: "READ",
  fetch_payment_link: "READ",
  fetch_payments_for_qr_code: "READ",
  fetch_payout_with_id: "READ",
  fetch_qr_code: "READ",
  fetch_qr_codes_by_customer_id: "READ",
  fetch_qr_codes_by_payment_id: "READ",
  fetch_refund: "READ",
  fetch_settlement_recon_details: "READ",
  fetch_settlement_with_id: "READ",
  fetch_specific_refund_for_payment: "READ",
  fetch_tokens: "READ",
  initiate_payment: "MONEY_IN",
  integrate_razorpay_checkout: "MONEY_IN",
  payment_link_notify: "READ",
  payment_link_upi_create: "MONEY_IN",
  resend_otp: "MONEY_IN",
  revoke_token: "READ",
  submit_otp: "MONEY_IN",
  update_order: "MONEY_IN",
  update_payment: "MONEY_IN",
  update_payment_link: "MONEY_IN",
  update_refund: "MONEY_OUT",
};

const path = new URL("../apps/proxy/config/upstream-tools.json", import.meta.url);
const dump = JSON.parse(readFileSync(path, "utf8"));
const missing = [];
dump.tools = dump.tools.map((t) => {
  const cls = CLASS[t.name];
  if (!cls) missing.push(t.name);
  return { ...t, class: cls ?? "UNCLASSIFIED" };
});
if (missing.length) {
  console.error("unclassified", missing);
  process.exit(1);
}
dump.railDecision = "s2s_order";
dump.note =
  "GET /v1/payouts returned 400; no create_payout MCP tool. pay() = create_order + test payment; reverse() = refund.";
writeFileSync(path, JSON.stringify(dump, null, 2) + "\n");
console.log(`classified ${dump.tools.length} tools`);
