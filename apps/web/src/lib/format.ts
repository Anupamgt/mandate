/** FR-14: format paise as rupees with integer arithmetic only. */
export function formatRupeesFromPaise(paise: number): string {
  const negative = paise < 0;
  const abs = negative ? -paise : paise;
  const rupees = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${negative ? "-" : ""}₹${rupees}.${String(remainder).padStart(2, "0")}`;
}

export function parsePaiseInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function budgetPercent(remaining: number, max: number): number {
  const cap = max > 0 ? max : 1;
  return Math.max(0, Math.min(100, Math.floor((remaining * 100) / cap)));
}
