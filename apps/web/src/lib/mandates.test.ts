import { describe, expect, it } from "vitest";
import { revokeRequestBody, toMandateList, type Mandate } from "./mandates";

function mandate(partial: Partial<Mandate> & Pick<Mandate, "id">): Mandate {
  return {
    status: "ACTIVE",
    agent_id: "agent_demo",
    remaining_paise: 50_000,
    body: {
      max_total_paise: 50_000,
      max_per_txn_paise: 10_000,
      purpose: "showcase compute",
    },
    ...partial,
  };
}

describe("FR-70 mandates list", () => {
  it("maps every mandate from GET /mandates, not only the first", () => {
    const rows = toMandateList([
      mandate({ id: "m-latest", remaining_paise: 40_000 }),
      mandate({ id: "m-mid", status: "REVOKED", remaining_paise: 10_000, agent_id: "agent_b" }),
      mandate({
        id: "m-old",
        remaining_paise: 0,
        body: { max_total_paise: 50_000, max_per_txn_paise: 10_000, purpose: "batch" },
      }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m-latest", "m-mid", "m-old"]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.status).toBe("ACTIVE");
    expect(rows[1]?.status).toBe("REVOKED");
    expect(rows[2]?.status).toBe("ACTIVE");
  });

  it("attaches remaining-budget bar as settled+reserved over max_total", () => {
    const [row] = toMandateList([mandate({ id: "m1", remaining_paise: 30_000 })]);
    expect(row?.used_paise).toBe(20_000);
    expect(row?.used_percent).toBe(40);
    expect(row?.remaining_percent).toBe(60);
    expect(row?.body.max_total_paise).toBe(50_000);
  });

  it("allows revoke only while ACTIVE", () => {
    const rows = toMandateList([
      mandate({ id: "live" }),
      mandate({ id: "dead", status: "REVOKED" }),
    ]);
    expect(rows[0]?.can_revoke).toBe(true);
    expect(rows[1]?.can_revoke).toBe(false);
  });
});

describe("FR-70 revoke payload", () => {
  it("is operator-signed body fields only — never a private key", () => {
    const body = revokeRequestBody("m1", "operator stop", "2026-09-02T12:00:00.000Z");
    expect(body).toEqual({
      mandate_id: "m1",
      reason: "operator stop",
      revoked_at: "2026-09-02T12:00:00.000Z",
    });
    expect(body).not.toHaveProperty("private_key");
    expect(body).not.toHaveProperty("priv");
    expect(body).not.toHaveProperty("signature");
  });
});
