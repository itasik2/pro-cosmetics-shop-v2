import type { ProposalText } from "./proposalText";

const EVENT = "procosmetics:proposal-changed";
export type ProposalChange = {
  id: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  text?: ProposalText & { textVersion: string };
};

export function applyProposalChange<T extends { id: string }>(
  rows: T[],
  change: ProposalChange,
): T[] {
  if (change.status !== "PENDING")
    return rows.filter((row) => row.id !== change.id);
  return rows.map((row) =>
    row.id === change.id && change.text ? { ...row, ...change.text } : row,
  );
}

export function publishProposalChange(
  change: ProposalChange,
  target: EventTarget = window,
) {
  target.dispatchEvent(new CustomEvent(EVENT, { detail: change }));
}

export function subscribeProposalChanges(
  callback: (change: ProposalChange) => void,
  target: EventTarget = window,
) {
  const listener = (event: Event) =>
    callback((event as CustomEvent<ProposalChange>).detail);
  target.addEventListener(EVENT, listener);
  return () => target.removeEventListener(EVENT, listener);
}
