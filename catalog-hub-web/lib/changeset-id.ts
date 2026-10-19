// Local SQL handlers use UUIDs; the Node enrichment service uses Prisma CUIDs.
export function isChangeSetId(id: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || /^c[a-z0-9]{24}$/.test(id);
}
