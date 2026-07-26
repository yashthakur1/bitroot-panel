import { run } from './runner';
import { shq } from './validate';

// Residue ledger: whenever the panel performs an action that deliberately
// leaves something behind (files, DNS records, database rows), it records an
// entry here so nothing is silently orphaned. Paired with the live scanner in
// the /api/residue route, this is the full picture of what is lingering.

const LEDGER = '"$HOME/.config/bitroot-panel/residue.json"';

export interface LedgerEntry {
  id: string;
  at: string;
  action: string;
  kind: 'files' | 'dns' | 'data' | 'config';
  what: string;
  target?: string;
  hint?: string;
}

export async function readLedger(): Promise<LedgerEntry[]> {
  const r = await run(`cat ${LEDGER} 2>/dev/null || echo "[]"`);
  try {
    const parsed = JSON.parse(r.output.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLedger(entries: LedgerEntry[]): Promise<void> {
  await run(
    `mkdir -p "$HOME/.config/bitroot-panel" && printf %s ${shq(JSON.stringify(entries, null, 2))} > ${LEDGER}`,
  );
}

export async function recordResidue(
  entries: Array<Omit<LedgerEntry, 'id' | 'at'>>,
): Promise<void> {
  if (entries.length === 0) return;
  const existing = await readLedger();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  const additions: LedgerEntry[] = entries.map((e, i) => ({
    ...e,
    id: `${now.getTime()}-${i}`,
    at: stamp,
  }));
  await writeLedger([...additions, ...existing].slice(0, 200));
}

export async function dismissResidue(id: string): Promise<void> {
  const existing = await readLedger();
  await writeLedger(existing.filter((e) => e.id !== id));
}
