import { z } from "zod";
import { asPaise, type Paise } from "@mandate/shared";

const paiseField = z
  .number()
  .int()
  .nonnegative()
  .transform((n) => asPaise(n));

export const mandateBodySchema = z.object({
  agent_id: z.string().min(1),
  principal_id: z.string().min(1),
  max_per_txn_paise: paiseField,
  max_total_paise: paiseField,
  valid_from: z.string().min(1),
  valid_until: z.string().min(1),
  allowed_counterparties: z.array(z.string().min(1)),
  allowed_tools: z.array(z.string().min(1)),
  purpose: z.string().min(1),
  step_up_above_paise: paiseField,
});

export type MandateBody = {
  agent_id: string;
  principal_id: string;
  max_per_txn_paise: Paise;
  max_total_paise: Paise;
  valid_from: string;
  valid_until: string;
  allowed_counterparties: readonly string[];
  allowed_tools: readonly string[];
  purpose: string;
  step_up_above_paise: Paise;
};

export function parseMandateBody(input: unknown): MandateBody {
  const parsed = mandateBodySchema.parse(input);
  return {
    ...parsed,
    allowed_counterparties: parsed.allowed_counterparties,
    allowed_tools: parsed.allowed_tools,
  };
}
