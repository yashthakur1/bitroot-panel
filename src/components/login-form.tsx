"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Mail, Terminal } from 'lucide-react';
import Logo from './logo';

export default function LoginForm({ server }: { server: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  // Asked for only when this panel actually has an identity. Installs that
  // predate sign-up sign in with the password alone, and showing them a field
  // they cannot fill would lock them out of their own machine.
  const [requiresEmail, setRequiresEmail] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth-mode')
      .then((r) => r.json())
      .then((d) => setRequiresEmail(Boolean(d.requiresEmail)))
      .catch(() => setRequiresEmail(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember }),
      });
      if (res.ok) {
        router.push('/dashboard');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'login failed');
    } catch {
      setError('could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  // One shared shape for both fields, so the email appearing or not appearing
  // never shifts the password field's dimensions.
  const field =
    'w-full h-[52px] pl-12 pr-12 rounded-full text-[15px] text-white placeholder:text-gray-600 ' +
    'bg-white/[0.03] border border-white/[0.08] ' +
    'transition-[border-color,background-color,box-shadow] duration-200 ease-swift ' +
    'hover:border-white/[0.14] ' +
    'focus:outline-none focus:bg-white/[0.05] focus:border-accent-500/50 ' +
    'focus:shadow-[0_0_0_4px_rgba(14,112,255,0.10)]';

  return (
    <div className="min-h-screen bg-[#05080f] text-gray-200 grid place-items-center px-5 py-10 relative overflow-hidden">
      {/* Ambient light instead of artwork: two soft radials, no image to load,
          nothing to go stale, and it scales to any viewport for free. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                        w-[820px] h-[820px] max-w-[160vw] max-h-[160vw] rounded-full
                        bg-[radial-gradient(circle,rgba(14,112,255,0.16)_0%,rgba(14,112,255,0.05)_38%,transparent_68%)]
                        blur-2xl" />
        <div className="absolute left-1/2 bottom-[-22%] -translate-x-1/2
                        w-[1100px] h-[620px] max-w-[190vw] rounded-full
                        bg-[radial-gradient(ellipse,rgba(30,90,220,0.20)_0%,transparent_62%)]
                        blur-3xl" />
      </div>

      <div className="relative w-full max-w-[460px]">
        {/* The card's own edge-light. Sits behind and bleeds out slightly,
            which is what separates it from the ground without a hard border. */}
        <div
          aria-hidden
          className="absolute -inset-px rounded-[30px] bg-gradient-to-b
                     from-accent-500/25 via-accent-500/[0.06] to-transparent blur-[2px]"
        />

        <div
          className="relative rounded-[30px] px-7 sm:px-9 py-10
                     bg-gradient-to-b from-white/[0.055] via-white/[0.02] to-white/[0.015]
                     border border-white/[0.08]
                     shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_40px_80px_-32px_rgba(0,0,0,0.9)]
                     backdrop-blur-xl animate-rise"
        >
          <div className="flex justify-center">
            <Logo />
          </div>

          <h1
            className="mt-7 text-center text-[2.4rem] leading-[1.1] font-display font-light
                       tracking-tight text-white text-balance animate-rise"
            style={{ animationDelay: '80ms' }}
          >
            Log in
          </h1>
          <p
            className="mt-3 text-center text-[14.5px] leading-relaxed text-gray-400 text-pretty
                       animate-rise"
            style={{ animationDelay: '140ms' }}
          >
            Sign in to pick up your services, deploys and storage exactly where you left
            them.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            {requiresEmail && (
              <div className="relative animate-rise" style={{ animationDelay: '200ms' }}>
                <Mail
                  size={16}
                  aria-hidden
                  className="absolute left-[18px] top-1/2 -translate-y-1/2 text-gray-500"
                />
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className={field}
                />
              </div>
            )}

            <div className="relative animate-rise" style={{ animationDelay: '240ms' }}>
              <Lock
                size={16}
                aria-hidden
                className="absolute left-[18px] top-1/2 -translate-y-1/2 text-gray-500"
              />
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus={requiresEmail === false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className={field}
              />
              {/* 40px hit area on a 16px glyph — the visible icon is the label,
                  not the target. */}
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
                className="absolute right-[9px] top-1/2 -translate-y-1/2 grid place-items-center
                           w-10 h-10 rounded-full text-gray-500
                           transition-colors duration-200 ease-swift
                           hover:text-gray-300 focus:outline-none
                           focus-visible:ring-2 focus-visible:ring-accent-500/40"
              >
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-400 pt-1 px-1">
                {error}
              </p>
            )}

            <div className="pt-3 animate-rise" style={{ animationDelay: '300ms' }}>
              <button
                type="submit"
                disabled={busy || !password || (requiresEmail === true && !email)}
                className="w-full h-[52px] rounded-full flex items-center justify-center gap-2
                           text-[15px] font-medium text-white
                           bg-gradient-to-b from-accent-500 to-accent-600
                           shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_10px_30px_-10px_rgba(14,112,255,0.7)]
                           transition-[opacity,scale,box-shadow] duration-200 ease-swift
                           hover:shadow-[0_1px_0_0_rgba(255,255,255,0.22)_inset,0_12px_34px_-10px_rgba(14,112,255,0.85)]
                           active:scale-[0.96]
                           disabled:opacity-40 disabled:active:scale-100
                           focus:outline-none focus-visible:ring-4 focus-visible:ring-accent-500/25"
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Log in
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between mt-5">
                <button
                  type="button"
                  onClick={() => setRemember((v) => !v)}
                  className="flex items-center gap-2.5 py-2 -my-2 text-sm text-gray-400
                             transition-colors duration-200 ease-swift
                             hover:text-gray-200 focus:outline-none focus-visible:text-gray-200"
                >
                  <span
                    aria-hidden
                    className={`grid place-items-center w-[18px] h-[18px] rounded-[6px] border
                                transition-[background-color,border-color] duration-200 ease-swift
                                ${
                                  remember
                                    ? 'bg-accent-500 border-accent-500'
                                    : 'bg-transparent border-white/20'
                                }`}
                  >
                    <Check
                      size={12}
                      strokeWidth={3}
                      className={`text-white icon-swap ${remember ? '' : 'is-off'}`}
                    />
                  </span>
                  <span role="checkbox" aria-checked={remember}>
                    Remember me
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecovery((v) => !v)}
                  className="text-sm text-accent-400 py-2 -my-2
                             transition-colors duration-200 ease-swift
                             hover:text-accent-300 focus:outline-none focus-visible:text-accent-300"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          </form>

          {/* There is no email reset on a single-user panel you host yourself.
              Saying where the password actually lives beats a dead link. */}
          {recovery && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4 animate-rise">
              <div className="flex items-center gap-2 text-gray-300 text-sm mb-2">
                <Terminal size={14} className="text-accent-400" />
                Recover it over SSH
              </div>
              <p className="text-[13px] text-gray-500 text-pretty mb-3">
                Nothing can email you a reset — the panel has no account system and no
                outbound mail. The password is a line in the env file on the device itself,
                readable by whoever can log into it:
              </p>
              {/* Wraps rather than scrolls: this is a command to be retyped,
                  and half of it hidden past the edge is the half you need. */}
              <pre className="text-[12px] font-mono text-gray-300 bg-black/50 rounded-xl p-3 whitespace-pre-wrap break-words">
                grep DASHBOARD_PASSWORD ~/apps/bitroot-panel/.env
              </pre>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-center gap-3 mt-7 text-[13px] animate-rise"
          style={{ animationDelay: '380ms' }}
        >
          <span className="flex items-center gap-2 text-gray-400">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            Panel online
          </span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-500">
            <span className="font-mono text-accent-400">{server}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
