// ZIP maps are keyed by filename: collisions must never overwrite another file.
export function availableExportName(filename: string, existing: string[]): string {
  const names = new Set(existing); if (!names.has(filename)) return filename;
  const dot = filename.lastIndexOf('.'), base = filename.slice(0, dot), extension = filename.slice(dot);
  let suffix = 2;
  while (names.has(`${base}-${suffix}${extension}`)) suffix++;
  return `${base}-${suffix}${extension}`;
}
