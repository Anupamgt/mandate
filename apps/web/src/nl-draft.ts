export type DraftWarning = "empty_allowlist" | "missing_caps";

export type DraftForm = {
  agent_id: string;
  principal_id: string;
  max_per_txn_paise: string;
  max_total_paise: string;
  valid_from: string;
  valid_until: string;
  allowed_counterparties: string;
  allowed_tools: string;
  purpose: string;
  step_up_above_paise: string;
};

export type DraftBody = {
  agent_id: string;
  principal_id: string;
  max_per_txn_paise: number;
  max_total_paise: number;
  valid_from: string;
  valid_until: string;
  allowed_counterparties: string[];
  allowed_tools: string[];
  purpose: string;
  step_up_above_paise: number;
};

export function parseCsvList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function toDraftForm(body: DraftBody): DraftForm {
  return {
    agent_id: body.agent_id,
    principal_id: body.principal_id,
    max_per_txn_paise: String(body.max_per_txn_paise),
    max_total_paise: String(body.max_total_paise),
    valid_from: body.valid_from,
    valid_until: body.valid_until,
    allowed_counterparties: body.allowed_counterparties.join(", "),
    allowed_tools: body.allowed_tools.join(", "),
    purpose: body.purpose,
    step_up_above_paise: String(body.step_up_above_paise),
  };
}

function rupeesLabel(raw: string): string {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return "—";
  return `₹${Math.trunc(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

export function liveDraftWarnings(
  form: DraftForm,
  seed: readonly DraftWarning[],
  original: DraftForm,
  capsTouched = false,
): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  if (parseCsvList(form.allowed_counterparties).length === 0) warnings.push("empty_allowlist");
  const capsUntouched =
    !capsTouched &&
    form.max_per_txn_paise === original.max_per_txn_paise &&
    form.max_total_paise === original.max_total_paise;
  if (seed.includes("missing_caps") && capsUntouched) warnings.push("missing_caps");
  return warnings;
}

export function canSignNlDraft(warnings: readonly DraftWarning[]): boolean {
  return warnings.length === 0;
}

export function englishReadback(form: DraftForm): string {
  const counterparties = parseCsvList(form.allowed_counterparties);
  const tools = parseCsvList(form.allowed_tools);
  const who =
    counterparties.length === 0
      ? "none (empty allowlist — fill before signing)"
      : counterparties.join(", ");
  return (
    `Agent ${form.agent_id} may spend at most ${rupeesLabel(form.max_per_txn_paise)} per transaction ` +
    `and ${rupeesLabel(form.max_total_paise)} total for "${form.purpose}", from ${form.valid_from} until ${form.valid_until}. ` +
    `Counterparties: ${who}. Tools: ${tools.join(", ") || "none"}. ` +
    `Step-up above ${rupeesLabel(form.step_up_above_paise)}.`
  );
}

export function formToMandateBody(form: DraftForm): DraftBody | string {
  const per = Number(form.max_per_txn_paise);
  const total = Number(form.max_total_paise);
  const step = Number(form.step_up_above_paise);
  if (![per, total, step].every((n) => Number.isInteger(n) && n >= 0)) {
    return "Caps and step-up must be integer paise.";
  }
  if (!form.agent_id.trim() || !form.principal_id.trim() || !form.purpose.trim()) {
    return "Agent, principal, and purpose are required.";
  }
  return {
    agent_id: form.agent_id.trim(),
    principal_id: form.principal_id.trim(),
    max_per_txn_paise: per,
    max_total_paise: total,
    valid_from: form.valid_from,
    valid_until: form.valid_until,
    allowed_counterparties: parseCsvList(form.allowed_counterparties),
    allowed_tools: parseCsvList(form.allowed_tools),
    purpose: form.purpose.trim(),
    step_up_above_paise: step,
  };
}

export function warningCopy(code: DraftWarning): string {
  if (code === "empty_allowlist") {
    return "Allowlist is empty. Name at least one counterparty before signing.";
  }
  return "Caps were not specified in the intent. Edit per-txn and total caps before signing.";
}
