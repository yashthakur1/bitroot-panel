"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Globe,
  Plus,
  X,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Copy,
  Lock,
  CornerDownRight,
} from "lucide-react";

type DnsStatus = "valid" | "invalid" | "unknown";

interface DomainStatus {
  site: string;
  domain: string;
  redirectTo: string | null;
  active: boolean;
  dns: DnsStatus;
  record: { type: "A"; name: string; value: string } | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// The per-site "Domains" panel: Vercel's "Add Domains" dialog, a status list
// with the exact DNS record each entry still needs, and a Refresh that
// re-checks and (once DNS is right) turns HTTPS on for it.
export default function DomainManager({ site }: { site: string }) {
  const [domains, setDomains] = useState<DomainStatus[] | null>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [redirectApex, setRedirectApex] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ domains: DomainStatus[]; publicIp: string | null }>(
        `/api/static/${site}/domains`,
      );
      setDomains(data.domains);
      setPublicIp(data.publicIp);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitAdd() {
    const domain = input.trim().toLowerCase();
    if (!domain) return;
    setBusy("add");
    setError("");
    try {
      const data = await api<{ domains: DomainStatus[] }>(`/api/static/${site}/domains`, {
        method: "POST",
        body: JSON.stringify({ domain, redirectApexToWww: redirectApex }),
      });
      setDomains(data.domains);
      setInput("");
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function refresh(domain?: string) {
    setBusy(domain ? `verify:${domain}` : "sync");
    setError("");
    try {
      const data = await api<{ domains: DomainStatus[] }>(`/api/static/${site}/domains/sync`, { method: "POST" });
      setDomains(data.domains);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function remove(domain: string) {
    setBusy(`remove:${domain}`);
    setError("");
    try {
      const data = await api<{ domains: DomainStatus[] }>(
        `/api/static/${site}/domains/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      setDomains(data.domains);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="border rounded-lg dark:border-gray-800">
      <div className="px-4 py-3 flex items-center justify-between border-b dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-gray-500 dark:text-gray-400" />
          <h2 className="font-medium text-sm">Domains</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || !domains?.length}
            onClick={() => refresh()}
          >
            {busy === "sync" ? (
              <Loader2 size={13} className="animate-spin mr-1.5" />
            ) : (
              <RefreshCw size={13} className="mr-1.5" />
            )}
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus size={13} className="mr-1.5" /> Add Domain
          </Button>
        </div>
      </div>

      {adding && (
        <div className="px-4 py-4 border-b dark:border-gray-800 space-y-3 bg-gray-50 dark:bg-gray-900/40">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="rapsap.com"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              disabled={busy === "add"}
            />
            <Button onClick={submitAdd} disabled={busy === "add" || !input.trim()}>
              {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : "Add"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setInput("");
                setError("");
              }}
            >
              <X size={14} />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-600"
              checked={redirectApex}
              onChange={(e) => setRedirectApex(e.target.checked)}
            />
            Redirect apex domain to www (recommended)
          </label>
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-sm text-red-600 dark:text-red-400 border-b dark:border-gray-800">{error}</p>
      )}

      {domains === null ? (
        <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : domains.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
          No custom domains yet. Add one to serve this site at your own domain, same as you would on Vercel.
        </div>
      ) : (
        <div className="divide-y dark:divide-gray-800">
          {domains.map((d) => (
            <div key={d.domain}>
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <StatusDot domain={d} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-mono text-sm text-gray-800 dark:text-gray-200">
                      {d.domain}
                    </div>
                    <div className="text-xs mt-0.5">
                      {d.dns === "valid" && d.active ? (
                        <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1">
                          <Lock size={11} /> {d.redirectTo ? `308 → ${d.redirectTo}` : "Serving over HTTPS"}
                        </span>
                      ) : d.dns === "valid" ? (
                        <span className="text-amber-600 dark:text-amber-400">DNS is correct — provisioning…</span>
                      ) : (
                        <button
                          className="text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1"
                          onClick={() => setExpanded(expanded === d.domain ? null : d.domain)}
                        >
                          Invalid Configuration
                          <ChevronDown
                            size={12}
                            className={expanded === d.domain ? "rotate-180 transition-transform" : "transition-transform"}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => refresh(d.domain)}
                    title="Re-check this domain"
                  >
                    {busy === `verify:${d.domain}` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 dark:text-red-400"
                    disabled={!!busy}
                    onClick={() => remove(d.domain)}
                  >
                    {busy === `remove:${d.domain}` ? <Loader2 size={13} className="animate-spin" /> : "Remove"}
                  </Button>
                </div>
              </div>

              {expanded === d.domain && d.record && (
                <div className="px-4 pb-4">
                  <div className="rounded-lg border dark:border-gray-800 overflow-hidden">
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 border-b dark:border-gray-800">
                      Add this record at your DNS provider (wherever {d.domain.split(".").slice(-2).join(".")} is
                      hosted — check your registrar if unsure):
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Value</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="px-3 py-2 font-mono">{d.record.type}</td>
                          <td className="px-3 py-2 font-mono">{d.record.name}</td>
                          <td className="px-3 py-2 font-mono">{d.record.value}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                              onClick={() => navigator.clipboard?.writeText(d.record!.value)}
                              title="Copy value"
                            >
                              <Copy size={13} />
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {!publicIp && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      Could not detect this server&apos;s public IP — the value above may be stale. Try refreshing.
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    DNS changes can take time to propagate. Click Refresh once it&apos;s in — this server also checks
                    automatically and issues a certificate the moment it resolves correctly.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ domain: d }: { domain: DomainStatus }) {
  if (d.dns === "valid" && d.active) {
    return d.redirectTo ? (
      <CornerDownRight size={15} className="text-gray-400 dark:text-gray-500 shrink-0" />
    ) : (
      <CheckCircle2 size={15} className="text-green-600 dark:text-green-400 shrink-0" />
    );
  }
  return <AlertTriangle size={15} className="text-red-500 shrink-0" />;
}
