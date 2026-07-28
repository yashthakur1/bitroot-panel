"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, Terminal } from 'lucide-react';
import Logo from './logo';

export default function LoginForm({ server }: { server: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, remember }),
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

  return (
    <div className="min-h-screen bg-[#05080f] text-gray-200 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Below the split breakpoint the artwork has nowhere to go, but this
          panel is often opened from a phone, so it stays as a dimmed backdrop
          rather than leaving a bare form on a flat background. */}
      <div className="lg:hidden absolute inset-0 overflow-hidden pointer-events-none">
        <Image
          src="/images/login-hero.webp"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          // Anchored left so the crop lands on the starfield: the artwork's
          // right side carries its own decorative readout, which reads as real
          // telemetry when it sits behind the form at low opacity.
          className="object-cover object-left opacity-[0.28]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05080f]/80 via-[#05080f]/60 to-[#05080f]" />
      </div>

      {/* ── form ───────────────────────────────────────────────── */}
      <div className="relative flex flex-col justify-center px-6 sm:px-12 lg:px-16 py-12 lg:py-16">
        <div className="w-full max-w-sm mx-auto lg:mx-0 lg:ml-auto lg:mr-12">
          <div className="animate-rise" style={{ animationDelay: '0ms' }}>
            <div className="flex items-center gap-3 mb-12">
              <Logo size={30} className="text-accent-400" />
              <div className="leading-none">
                <div className="text-[15px] font-medium tracking-[0.28em] text-gray-100">
                  BITPANEL
                </div>
                <div className="text-[10px] tracking-[0.22em] text-gray-500 mt-1.5 font-mono">
                  SELF&#8209;HOSTED
                </div>
              </div>
            </div>
          </div>

          <div className="animate-rise" style={{ animationDelay: '80ms' }}>
            <h1 className="text-[2.1rem] leading-[1.15] font-display font-light text-balance text-white">
              Welcome back.
              <br />
              Your <span className="text-accent-400">server</span> is ready.
            </h1>
            <p className="text-sm text-gray-500 mt-3 text-pretty">
              Secure access to the machine you own.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-9">
            <div className="animate-rise" style={{ animationDelay: '160ms' }}>
              <label
                htmlFor="password"
                className="block text-[11px] font-medium tracking-[0.16em] text-accent-400/90 mb-2"
              >
                PASSWORD
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                />
                <input
                  id="password"
                  name="password"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoFocus
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 pl-10 pr-12 rounded-xl bg-white/[0.03] border border-white/10
                             text-[15px] text-gray-100 placeholder:text-gray-600
                             transition-[border-color,background-color,box-shadow] duration-200
                             ease-swift
                             hover:border-white/[0.16]
                             focus:outline-none focus:border-accent-500/70
                             focus:bg-white/[0.05] focus:ring-4 focus:ring-accent-500/10"
                />
                {/* Both icons stay mounted and cross-fade, so the toggle has an
                    exit as well as an enter without pulling in a motion library. */}
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center
                             w-10 h-10 rounded-lg text-gray-500
                             transition-colors duration-200 ease-swift
                             hover:text-gray-300 focus:outline-none focus-visible:text-gray-200"
                >
                  <span className="relative block w-[15px] h-[15px]">
                    <Eye size={15} className={`absolute inset-0 icon-swap ${reveal ? '' : 'is-off'}`} />
                    <EyeOff size={15} className={`absolute inset-0 icon-swap ${reveal ? 'is-off' : ''}`} />
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-400 mt-3">
                {error}
              </p>
            )}

            <div className="animate-rise" style={{ animationDelay: '240ms' }}>
              <button
                type="submit"
                disabled={busy || !password}
                className="mt-5 w-full h-12 rounded-xl flex items-center justify-center gap-2
                           text-[15px] font-medium text-white
                           bg-gradient-to-r from-accent-600 to-accent-500
                           shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_8px_24px_-8px_rgba(14,112,255,0.6)]
                           transition-[opacity,scale,box-shadow] duration-200
                           ease-swift
                           hover:shadow-[0_1px_0_0_rgba(255,255,255,0.16)_inset,0_10px_28px_-8px_rgba(14,112,255,0.75)]
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

              <div className="flex items-center justify-between mt-4">
                <button
                  type="button"
                  onClick={() => setRemember((v) => !v)}
                  className="flex items-center gap-2.5 py-2 -my-2 text-sm text-gray-400
                             transition-colors duration-200 ease-swift
                             hover:text-gray-200 focus:outline-none focus-visible:text-gray-200"
                >
                  <span
                    aria-hidden
                    className={`grid place-items-center w-[18px] h-[18px] rounded-[5px] border
                                transition-[background-color,border-color] duration-200
                                ease-swift
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
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 animate-rise">
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
              <pre className="text-[12px] font-mono text-gray-300 bg-black/40 rounded-lg p-3 whitespace-pre-wrap break-words">
                grep DASHBOARD_PASSWORD ~/apps/bitroot-panel/.env
              </pre>
            </div>
          )}

          <div
            className="flex items-center gap-3 mt-14 text-[13px] animate-rise"
            style={{ animationDelay: '320ms' }}
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
              Server: <span className="font-mono text-accent-400">{server}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── artwork ────────────────────────────────────────────── */}
      <div className="relative hidden lg:block overflow-hidden">
        <Image
          src="/images/login-hero.webp"
          alt=""
          fill
          priority
          unoptimized
          sizes="55vw"
          className="object-cover object-center"
        />
        {/* Blend the artwork into the form side instead of butting two panels
            together with a hard seam down the middle. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#05080f] via-transparent to-transparent" />
        <div className="absolute inset-y-0 left-0 w-px bg-white/[0.06]" />
      </div>
    </div>
  );
}
