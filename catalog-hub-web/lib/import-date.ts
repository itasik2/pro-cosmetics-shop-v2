export function dateFromFileName(name: string): string | null {
  const separated = name.match(/(?:^|\D)([0-3]\d)[.\-_ ]([01]\d)[.\-_ ](20\d{2})(?:\D|$)/);
  const compact = name.match(/(?:^|\D)([0-3]\d)([01]\d)(20\d{2})(?:\D|$)/);
  const match = separated || compact;
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

export function previousAppliedDate(
  history: Array<{profileId:string|null;fileName:string;sourceDate?:string|null;action:string;result:string}>,
  profileId:string|null,
): string|null {
  if (!profileId) return null;
  const dates = history.filter(row => row.profileId === profileId && row.action === "APPLY" &&
    row.result === "COMPLETED").map(row => row.sourceDate || dateFromFileName(row.fileName))
    .filter((value): value is string => Boolean(value));
  return dates.sort().at(-1) || null;
}
