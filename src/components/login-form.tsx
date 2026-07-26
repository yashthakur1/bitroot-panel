"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
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
        body: JSON.stringify({ password }),
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
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-black rounded flex items-center justify-center">
          <span className="text-white font-bold">B</span>
        </div>
        <h1 className="text-2xl font-medium text-gray-900">Bitroot Panel</h1>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Deploy and manage apps on the OnePlus server
      </p>

      <form onSubmit={handleSubmit} className="mb-2">
        <div className="flex flex-col space-y-4 mb-6">
          <div className="flex flex-col">
            <Label htmlFor="password" className="font-sans">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className="font-sans"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <Button type="submit" className="font-medium font-sans w-full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
