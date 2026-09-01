/** Integer paise. Never floats. FR-14. */
export type Paise = number & { readonly __brand: unique symbol };

export function asPaise(n: number): Paise {
  if (!Number.isInteger(n)) {
    throw new Error("Paise must be an integer");
  }
  if (n < 0) {
    throw new Error("Paise must be non-negative");
  }
  return n as Paise;
}
