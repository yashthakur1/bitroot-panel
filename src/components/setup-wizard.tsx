"use client";

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';

interface State {
  complete: boolean;
  domain: string | null;
  tailscale: { host: string | null; detected: string | null };
  garage: { token: boolean; reachable: boolean };
}

interface Permission {
  name: string;
  ok: boolean;
  why: string;
}

export default function SetupWizard() {
  const [state, setState] = useState<State | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const [domain, setDomain] = useState('');
  const [password, setPassword] = useState('');
  const [tailnetHost, setTailnetHost] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [cfZoneId, setCfZoneId] = useState('');
  const [checked, setChecked] = useState<{ ok: boolean; zoneName?: string; permissions: Permission[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/setup');
    const d = await res.json();
    setState(d);
    if (d.tailscale?.detected) setTailnetHost(d.tailscale.detected);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function verifyCloudflare() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'verify-cloudflare', token: cfToken, zoneId: cfZoneId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setChecked(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'save',
          domain,
          password,
          tailnetHost: tailnetHost || undefined,
          cfToken: cfToken || undefined,
          cfZoneId: cfZoneId || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (state?.complete && !done) {
    return (
      <Shell>
        <h1 className="text-2xl font-display font-light mb-2">Already configured</h1>
        <p className="text-gray-600 dark:text-gray-400 text-pretty">
          This panel has been set up. The wizard closes itself once that is true, so it cannot be
          used to change credentials from outside.
        </p>
        <Link href="/" className="inline-block mt-6">
          <Button>Go to the panel</Button>
        </Link>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-2xl font-display font-light mb-2 flex items-center gap-2">
          <Check size={20} className="text-green-600" /> Configured
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-pretty mb-4">
          Written to <code className="font-mono text-sm">.env</code>. The panel has to be restarted
          before it takes effect — some values are compiled into the browser bundle, so a restart
          alone is not enough for those.
        </p>
        <pre className="bg-gray-950 text-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto">
{`cd ~/apps/bitroot-panel
npm run build && pm2 restart bitroot-panel`}
        </pre>
      </Shell>
    );
  }

  const steps = ['Panel', 'Domain', 'Cloudflare', 'Review'];

  return (
    <Shell>
      <h1 className="text-2xl font-display font-light mb-1">Set up BitPanel</h1>
      <p className="text-gray-600 dark:text-gray-400 text-sm mb-6 text-pretty">
        Four short steps. Everything is checked against the service it configures, so a wrong value
        is caught here rather than the first time you use it.
      </p>

      <div className="flex gap-1.5 mb-6">
        {steps.map((s, i) => (
          <div key={s} className="flex-1">
            <div
              className={`h-1 rounded-full ${i <= step ? 'bg-accent-500' : 'bg-gray-200 dark:bg-gray-800'}`}
            />
            <p className={`text-[11px] mt-1.5 ${i === step ? 'text-accent-600 dark:text-accent-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {s}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-4 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <Field
            label="Dashboard password"
            hint="At least 12 characters. This is the only thing standing between the panel and anyone who can reach the port."
          >
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Nav onNext={() => setStep(1)} nextDisabled={password.length < 12} />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <Field
            label="Domain"
            hint="The zone routes are created under. A service called blog becomes blog.<domain>."
          >
            <input
              autoFocus
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase())}
              className={inputCls}
            />
          </Field>
          <Field
            label="Tailscale hostname"
            hint={
              state?.tailscale.detected
                ? 'Detected from Tailscale on this machine.'
                : 'Optional. Leave empty if you are not using Tailscale — private URLs will simply not be offered.'
            }
          >
            <input
              placeholder="machine.tailnet.ts.net"
              value={tailnetHost}
              onChange={(e) => setTailnetHost(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!/\./.test(domain)} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 text-pretty">
            Optional — skip it and the panel runs without public routes. The token needs four
            permissions, and the account-level one is the easy one to miss.
          </p>
          <Field label="API token" hint="Zone:DNS:Edit, Zone:Cache Rules:Edit, Zone:Cache Purge:Purge, Account:Account Rulesets:Edit">
            <input type="password" value={cfToken} onChange={(e) => setCfToken(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Zone ID" hint="On the zone's overview page in the Cloudflare dashboard.">
            <input value={cfZoneId} onChange={(e) => setCfZoneId(e.target.value)} className={inputCls} />
          </Field>

          <Button variant="outline" disabled={busy || !cfToken || !cfZoneId} onClick={verifyCloudflare}>
            {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
            Check the token
          </Button>

          {checked && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
              {checked.zoneName && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Zone: <code className="font-mono">{checked.zoneName}</code>
                </p>
              )}
              {checked.permissions.map((p) => (
                <div key={p.name} className="flex items-start gap-2 text-xs">
                  {p.ok ? (
                    <Check size={13} className="text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <X size={13} className="text-red-500 shrink-0 mt-0.5" />
                  )}
                  <span>
                    <span className={p.ok ? 'text-gray-700 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}>
                      {p.name}
                    </span>
                    <span className="block text-gray-500 dark:text-gray-400">{p.why}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel={cfToken ? 'Next' : 'Skip Cloudflare'} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <dl className="text-sm space-y-2">
            <Row k="Domain" v={domain} />
            <Row k="Tailscale" v={tailnetHost || 'not configured'} />
            <Row k="Cloudflare" v={cfToken ? (checked?.ok ? 'verified' : 'set, not verified') : 'not configured'} />
            <Row k="Garage" v={state?.garage.reachable ? 'reachable' : 'not reachable yet'} />
          </dl>
          {cfToken && checked && !checked.ok && (
            <p className="text-xs text-amber-700 dark:text-amber-500 text-pretty">
              Some permissions failed their check. Saving is allowed — the panel degrades to what
              works — but routes or cache rules will fail until the token is fixed.
            </p>
          )}
          <Nav onBack={() => setStep(2)} onNext={save} nextLabel="Save configuration" busy={busy} />
        </div>
      )}
    </Shell>
  );
}

const inputCls =
  'w-full px-3 py-2 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-500';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-white dark:bg-gray-900">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      <span className="block text-xs text-gray-500 dark:text-gray-400 text-pretty">{hint}</span>
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-1.5">
      <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
      <dd className="text-gray-800 dark:text-gray-200 text-right">{v}</dd>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled,
  busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex justify-between pt-2">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button onClick={onNext} disabled={nextDisabled || busy} className="flex items-center gap-1.5">
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {nextLabel} <ArrowRight size={14} />
      </Button>
    </div>
  );
}
