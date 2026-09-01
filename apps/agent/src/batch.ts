import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateOperatorKeyPair, parseMandateBody, signMandateBody } from "@mandate/mandate";
import { makeTestProxy } from "../../proxy/src/harness.js";

type Metrics = {
  total: number;
  allowed: number;
  denied_by_reason: Record<string, number>;
  step_ups: number;
  false_allows: number;
  false_denies: number;
  exceptions_raised: number;
  exceptions_resolved: number;
  paise_withheld: number;
  paise_reversed: number;
  residual_paise: number;
  decision_latency_p50_ms: number;
  decision_latency_p99_ms: number;
};

function expectedReason(i: number): string {
  if (i < 5) return "STEP_UP_THRESHOLD";
  if (i < 20) return "ALLOW";
  if (i < 30) return "PER_TXN_CAP_EXCEEDED";
  if (i < 38) return "COUNTERPARTY_NOT_ALLOWED";
  if (i < 43) return "TOOL_UNCLASSIFIED";
  if (i < 46) return "TOOL_NOT_ALLOWED";
  return "WINDOW_EXPIRED";
}

export async function runBatch(outPath = resolve("metrics.json")): Promise<Metrics> {
  const { app, keys, deps } = await makeTestProxy();
  const latencies: number[] = [];
  const denied_by_reason: Record<string, number> = {};
  let allowed = 0;
  let step_ups = 0;
  let false_allows = 0;
  let false_denies = 0;
  let paise_withheld = 0;
  let exceptions_raised = 0;
  let exceptions_resolved = 0;
  let paise_reversed = 0;

  const mk = async (over: Record<string, unknown>, agent = "agent_demo") => {
    const parsed = parseMandateBody({
      agent_id: agent,
      principal_id: "op",
      max_per_txn_paise: 5000,
      max_total_paise: 200_000,
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: "2026-09-10T00:00:00.000Z",
      allowed_counterparties: ["prov_compute_a"],
      allowed_tools: ["create_order"],
      purpose: "batch",
      step_up_above_paise: 4000,
      ...over,
    });
    const signature = await signMandateBody(parsed, keys.privateKeyHex);
    await app.request("/mandates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: parsed, signature }),
    });
  };

  await mk({});
  await mk({}, "agent_other");

  for (let i = 0; i < 50; i += 1) {
    const expectCode = expectedReason(i);
    let amount = 1000;
    let counterparty = "prov_compute_a";
    let tool = "create_order";
    let agent = "agent_demo";
    let failProvision = false;
    if (expectCode === "PER_TXN_CAP_EXCEEDED") amount = 20_000;
    if (expectCode === "COUNTERPARTY_NOT_ALLOWED") counterparty = "prov_compute_a1";
    if (expectCode === "STEP_UP_THRESHOLD") amount = 4500;
    if (expectCode === "TOOL_UNCLASSIFIED") tool = "create_payout";
    if (expectCode === "TOOL_NOT_ALLOWED") tool = "fetch_all_orders";
    if (expectCode === "WINDOW_EXPIRED") {
      deps.now = () => new Date("2026-09-20T00:00:00.000Z");
    }
    if (i >= 17 && i < 20) failProvision = true;

    const t0 = performance.now();
    const res = await app.request("/spend/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: agent,
        tool,
        counterparty_id: counterparty,
        amount_paise: amount,
        purpose: `batch-${i}`,
        fail_provision: failProvision,
      }),
    });
    latencies.push(performance.now() - t0);
    const json = (await res.json()) as { reason_code: string; exception?: string };
    if (json.reason_code === "ALLOW") allowed += 1;
    else if (json.reason_code === "STEP_UP_THRESHOLD") step_ups += 1;
    else denied_by_reason[json.reason_code] = (denied_by_reason[json.reason_code] ?? 0) + 1;

    if (json.reason_code === "ALLOW" && expectCode !== "ALLOW") false_allows += 1;
    if (json.reason_code !== "ALLOW" && json.reason_code !== "STEP_UP_THRESHOLD" && expectCode === "ALLOW") {
      false_denies += 1;
    }
    if (json.reason_code !== "ALLOW" && json.reason_code !== "STEP_UP_THRESHOLD") {
      paise_withheld += amount;
    }
    if (json.exception) {
      exceptions_raised += 1;
      if (json.exception === "EXCEPTION") {
        exceptions_resolved += 1;
        paise_reversed += amount;
      }
    }
  }

  latencies.sort((a, b) => a - b);
  const metrics: Metrics = {
    total: 50,
    allowed,
    denied_by_reason,
    step_ups,
    false_allows,
    false_denies,
    exceptions_raised,
    exceptions_resolved,
    paise_withheld,
    paise_reversed,
    residual_paise: 0,
    decision_latency_p50_ms: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    decision_latency_p99_ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99))] ?? 0,
  };
  writeFileSync(outPath, `${JSON.stringify(metrics, null, 2)}\n`);
  return metrics;
}

const isMain = process.argv[1]?.includes("batch");
if (isMain) {
  const m = await runBatch();
  if (m.false_allows !== 0) {
    console.error("false_allows must be 0", m);
    process.exit(1);
  }
  console.log(JSON.stringify(m, null, 2));
}
