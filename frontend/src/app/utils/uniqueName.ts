// Generates a non-colliding name for a duplicated entity by appending/bumping
// a trailing number, e.g. "Production" -> "Production 2" -> "Production 3".
export function generateDuplicateName(originalName: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  const trailingNumberMatch = originalName.match(/^(.*?)\s+(\d+)$/);
  const base = trailingNumberMatch ? trailingNumberMatch[1] : originalName;
  let counter = trailingNumberMatch ? parseInt(trailingNumberMatch[2], 10) + 1 : 2;
  let candidate = `${base} ${counter}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${base} ${counter}`;
  }
  return candidate;
}
