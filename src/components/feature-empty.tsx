'use client';

import Link from 'next/link';
import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, Hexagon, Plus, X, type LucideIcon } from 'lucide-react';
import { Button } from './ui/button';

// The first thing a feature shows before it has anything in it.
//
// Every page used to render its own "No X yet" box: one grey sentence and a
// button, different on each page. That told a new operator the list was empty
// but not what the feature was for, which is exactly the question an empty page
// raises. This says what it is, shows a sketch of what it looks like once used,
// and offers the one action that fills it.
//
// The sketch is drawn in HTML rather than shipped as an image: it follows the
// light and dark theme, stays sharp at any zoom, and adds nothing to the
// download on a machine that is sometimes a phone.

// `go` is for an action that takes you somewhere rather than making something.
// It gets an arrow instead of a plus: a plus promises something new will exist.
type Action =
  | { label: string; href: string; external?: boolean; go?: boolean; onClick?: never }
  | { label: string; onClick: () => void; go?: boolean; href?: never; external?: never };

export interface FeatureEmptyProps {
  /** Stable key for remembering that the sketch was hidden. */
  id: string;
  icon: LucideIcon | ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
  action?: Action;
  /** Omitted where no real page exists. A link to nowhere is worse than none. */
  learnMore?: string;
  /** Shown beside the title — for a feature that exists here but cannot be used yet. */
  badge?: string;
  illustration: ReactNode;
}

const STORAGE_KEY = (id: string) => `bp-empty-hidden:${id}`;

// Per viewer and best-effort: private windows and blocked storage throw, and
// the placeholder must still render when they do.
function readHidden(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY(id)) === '1';
  } catch {
    return memory.get(id) ?? false;
  }
}

// In-memory fallback, so hiding still works for the rest of the visit when
// storage is unavailable rather than the click appearing to do nothing.
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function writeHidden(id: string, hidden: boolean) {
  memory.set(id, hidden);
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY(id), '1');
    else window.localStorage.removeItem(STORAGE_KEY(id));
  } catch {
    /* storage unavailable: the in-memory value carries it */
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab hiding the same placeholder.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function FeatureEmpty({
  id,
  icon: Icon,
  title,
  description,
  action,
  learnMore,
  badge,
  illustration,
}: FeatureEmptyProps) {
  // The server cannot see localStorage, so it always renders the preview. A
  // plain lazy useState read storage on the client's first render and drew the
  // placeholder hidden instead — a hydration mismatch (React #418) on Projects,
  // which renders this on the server. useSyncExternalStore renders the server
  // snapshot while hydrating, then switches to the stored value.
  const hidden = useSyncExternalStore(
    subscribe,
    () => readHidden(id),
    () => false,
  );
  const hide = (next: boolean) => writeHidden(id, next);

  const primary = action && (
    <ActionButton action={action} />
  );

  return (
    <section
      className="fade-in-up relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/70 grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className={`flex flex-col justify-center gap-5 px-5 py-7 sm:px-10 sm:py-12 ${hidden ? 'md:col-span-2' : ''}`}>
        {badge && (
          <span className="sm:ml-10 self-start inline-flex items-center text-[10px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-0.5">
            {badge}
          </span>
        )}
        <div className="flex items-start gap-3">
          <Icon size={28} strokeWidth={1.5} className="shrink-0 mt-0.5 text-gray-800 dark:text-gray-200" />
          <h2
            className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-gray-900 dark:text-gray-50"
            style={{ textWrap: 'balance' }}
          >
            {title}
          </h2>
        </div>

        <p
          className="text-base text-gray-600 dark:text-gray-300 max-w-md sm:pl-10"
          style={{ textWrap: 'pretty' }}
        >
          {description}
        </p>

        {(primary || learnMore || hidden) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:pl-10">
            {primary}
            {learnMore && (
              <a
                href={learnMore}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent-600 dark:text-accent-400 hover:underline underline-offset-4"
              >
                Learn more <ArrowUpRight size={14} />
              </a>
            )}
            {hidden && (
              <button
                type="button"
                onClick={() => hide(false)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                Show preview
              </button>
            )}
          </div>
        )}
      </div>

      {!hidden && (
        <div
          className="relative hidden md:block min-h-[18rem] border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 bp-empty-grid"
        >
          {/* aria-hidden here, not on the panel: it cannot be undone by a
              descendant, so on the panel it would also hide the close button. */}
          <div aria-hidden="true" className="absolute left-[7%] top-[12%] -right-[6%] -bottom-[30%]">
            {illustration}
          </div>
          <button
            type="button"
            aria-label="Hide preview"
            onClick={() => hide(true)}
            className="absolute right-3 top-3 grid size-10 place-items-center rounded-md text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors active:scale-[0.96]"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </section>
  );
}

function ActionButton({ action }: { action: Action }) {
  const content = action.go ? (
    <>
      {action.label} <ArrowRight size={16} className="ml-1.5" />
    </>
  ) : (
    <>
      <Plus size={16} className="mr-1.5" /> {action.label}
    </>
  );
  if (action.onClick) {
    return (
      <Button onClick={action.onClick} className="whitespace-nowrap active:scale-[0.96] transition-[background-color,scale]">
        {content}
      </Button>
    );
  }
  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer">
        <Button className="whitespace-nowrap active:scale-[0.96] transition-[background-color,scale]">
          {action.label} <ArrowUpRight size={16} className="ml-1.5" />
        </Button>
      </a>
    );
  }
  return (
    <Link href={action.href!}>
      <Button className="whitespace-nowrap active:scale-[0.96] transition-[background-color,scale]">{content}</Button>
    </Link>
  );
}

// ─── the sketch ──────────────────────────────────────────────────────────────
//
// One window shape for every feature, so the placeholders read as a set: a
// title bar, a list down the left with one row selected, and a detail pane with
// a mono label, a name, a status, and groups of tiles. Each feature fills the
// pane with its own nouns.

export interface MockGroup {
  label: string;
  tiles: LucideIcon[];
}

export function MockWindow({
  kind,
  name,
  nameIcon: NameIcon,
  status,
  groups,
}: {
  kind: string;
  name: string;
  nameIcon: LucideIcon;
  status: string;
  groups: MockGroup[];
}) {
  return (
    <div className="flex h-full flex-col rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] dark:shadow-none">
      <div className="flex gap-1.5 border-b border-gray-200 dark:border-gray-800 px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 rounded-[1px] bg-gray-200 dark:bg-gray-800" />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-5 p-5">
        <div className="w-[26%] shrink-0 space-y-2.5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className={`h-7 rounded-[3px] border ${
                i === 1
                  ? 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 shadow-[inset_2px_0_0_theme(colors.gray.400)] dark:shadow-[inset_2px_0_0_theme(colors.gray.600)]'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            />
          ))}
        </div>

        <div className="flex-1 min-w-0 rounded-[3px] border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                {kind}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <NameIcon size={16} strokeWidth={1.5} />
                <span className="truncate text-base font-display">{name}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                <Check size={11} /> {status}
              </span>
              {[0, 1].map((i) => (
                <span key={i} className="size-6 rounded-[3px] border border-gray-200 dark:border-gray-800" />
              ))}
            </div>
          </div>

          <div className="mt-7 grid grid-cols-3 gap-4">
            {groups.map((g) => (
              <div key={g.label} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  <Hexagon size={13} strokeWidth={1.25} strokeDasharray="2.5 2" />
                  <span className="truncate">{g.label}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {g.tiles.map((T, i) => (
                    <span
                      key={i}
                      className="grid size-9 place-items-center rounded-[3px] border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 text-gray-400 dark:text-gray-600"
                    >
                      <T size={15} strokeWidth={1.25} />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Activity lines under the groups. Same for every feature on
              purpose: it only has to say "things happen here", and it runs
              past the card's edge so the sketch reads as a real, longer page. */}
          <div className="mt-9 space-y-4">
            {['w-[82%]', 'w-[64%]', 'w-[74%]', 'w-[56%]', 'w-[70%]'].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="size-3 shrink-0 rounded-[2px] border border-gray-200 dark:border-gray-800" />
                <span className={`h-1.5 rounded-full bg-gray-100 dark:bg-gray-800/70 ${w}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
