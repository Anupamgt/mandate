import { describe, expect, it } from "vitest";
import { signMandateBody, signRevocation, parseMandateBody } from "@mandate/mandate";
import { makeTestProxy } from "./harness.js";

const body = {
  agent_id: "agent_demo",
  principal_id: "op",
  max_per_txn_paise: 10_000,
  max_total_paise: 50_000,
  valid_from: "2026-09-01T00:00:00.000Z",
  valid_until: "2026-09-10T00:00:00.000Z",
  allowed_counterparties: ["prov_compute_a"],
  allowed_tools: ["create_order", "update_refund"],
  purpose: "compute",
  step_up_above_paise: 8_000,
};

describe("REST gate", () => {
  it("issues, reads remaining budget, denies over cap, revokes", async () => {
    const { app, keys } = await makeTestProxy();
    const parsed = parseMandateBody(body);
    const signature = await signMandateBody(parsed, keys.privateKeyHex);
    const issued = await app.request("/mandates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: parsed, signature }),
    });
    expect(issued.status).toBe(201);
    const { id } = (await issued.json()) as { id: string };

    const got = await app.request(`/mandates/${id}`);
    const payload = (await got.json()) as { remaining_paise: number; status: string };
    expect(payload.status).toBe("ACTIVE");
    expect(payload.remaining_paise).toBe(50_000);

    const deny = await app.request("/spend/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent_demo",
        tool: "create_order",
        counterparty_id: "prov_compute_a",
        amount_paise: 20_000,
        purpose: "too much",
      }),
    });
    const denied = (await deny.json()) as { reason_code: string };
    expect(denied.reason_code).toBe("PER_TXN_CAP_EXCEEDED");

    const allow = await app.request("/spend/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent_demo",
        tool: "create_order",
        counterparty_id: "prov_compute_a",
        amount_paise: 1000,
        purpose: "ok",
        resource: "compute/run",
      }),
    });
    const allowed = (await allow.json()) as { reason_code: string; proof: { mac: string } };
    expect(allowed.reason_code).toBe("ALLOW");
    expect(allowed.proof.mac.length).toBeGreaterThan(8);

    const revokedAt = "2026-09-02T12:00:00.000Z";
    const revSig = await signRevocation(
      { mandate_id: id, reason: "stop", revoked_at: revokedAt },
      keys.privateKeyHex,
    );
    const rev = await app.request(`/mandates/${id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "stop", signature: revSig }),
    });
    expect(rev.status).toBe(200);

    const after = await app.request("/spend/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent_demo",
        tool: "create_order",
        counterparty_id: "prov_compute_a",
        amount_paise: 1000,
        purpose: "after revoke",
      }),
    });
    const afterJson = (await after.json()) as { reason_code: string };
    expect(afterJson.reason_code).toBe("MANDATE_REVOKED");
  });

  it("FR-70 GET /mandates returns remaining_paise for every mandate", async () => {
    const { app, keys } = await makeTestProxy();
    const first = parseMandateBody(body);
    const second = parseMandateBody({ ...body, agent_id: "agent_b", purpose: "other" });
    const issued = await Promise.all(
      [first, second].map(async (parsed) => {
        const signature = await signMandateBody(parsed, keys.privateKeyHex);
        const res = await app.request("/mandates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: parsed, signature }),
        });
        expect(res.status).toBe(201);
        return (await res.json()) as { id: string };
      }),
    );
    const list = await app.request("/mandates");
    const json = (await list.json()) as {
      mandates: Array<{ id: string; status: string; remaining_paise: number; body: { max_total_paise: number } }>;
    };
    expect(json.mandates).toHaveLength(2);
    expect(json.mandates.map((m) => m.id).sort()).toEqual(issued.map((i) => i.id).sort());
    for (const row of json.mandates) {
      expect(row.status).toBe("ACTIVE");
      expect(row.remaining_paise).toBe(50_000);
      expect(row.body.max_total_paise).toBe(50_000);
    }
  });

  it("FR-13 ten parallel ₹100 vs ₹500 cap", async () => {
    const { app, keys } = await makeTestProxy();
    const parsed = parseMandateBody({
      ...body,
      max_per_txn_paise: 10_000,
      max_total_paise: 50_000,
      step_up_above_paise: 50_000,
    });
    const signature = await signMandateBody(parsed, keys.privateKeyHex);
    await app.request("/mandates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: parsed, signature }),
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request("/spend/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent_id: "agent_demo",
            tool: "create_order",
            counterparty_id: "prov_compute_a",
            amount_paise: 10_000,
            purpose: `p${i}`,
            invoice_id: `inv_parallel_${i}`,
          }),
        }),
      ),
    );
    const bodies = await Promise.all(
      results.map(async (r) => (await r.json()) as { reason_code?: string; error?: string; status?: number }),
    );
    const allowed = bodies.filter((b) => b.reason_code === "ALLOW").length;
    const capped = bodies.filter((b) => b.reason_code === "CUM_CAP_EXCEEDED").length;
    expect(bodies, JSON.stringify(bodies)).toHaveLength(10);
    expect(allowed, JSON.stringify(bodies)).toBeLessThanOrEqual(5);
    expect(capped, JSON.stringify(bodies)).toBeGreaterThanOrEqual(5);
    expect(allowed + capped).toBe(10);
  });

  it("SEC-08 RATE_LIMITED is enforced by the proxy, not evaluate()", async () => {
    const { app, keys } = await makeTestProxy({ rateLimitPerMinute: 2 });
    const parsed = parseMandateBody({ ...body, step_up_above_paise: 50_000 });
    const signature = await signMandateBody(parsed, keys.privateKeyHex);
    await app.request("/mandates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: parsed, signature }),
    });
    const propose = () =>
      app.request("/spend/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "agent_demo",
          tool: "create_order",
          counterparty_id: "prov_compute_a",
          amount_paise: 1000,
          purpose: "rate",
        }),
      });
    const first = (await (await propose()).json()) as { reason_code: string };
    const second = (await (await propose()).json()) as { reason_code: string };
    const third = (await (await propose()).json()) as { reason_code: string };
    expect(first.reason_code).toBe("ALLOW");
    expect(second.reason_code).toBe("ALLOW");
    expect(third.reason_code).toBe("RATE_LIMITED");
  });
});
