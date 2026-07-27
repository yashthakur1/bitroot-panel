"use client";

// Underline tab bar shared by every dashboard page, so context switching looks
// and behaves the same everywhere.
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count?: number }>;
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="border-b dark:border-gray-800 flex gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`py-2 px-3 text-sm font-medium -mb-px whitespace-nowrap transition-colors ${
            active === t.key
              ? 'text-accent-600 dark:text-accent-400 border-b-2 border-accent-600 dark:border-accent-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs tabular-nums text-gray-400 dark:text-gray-500">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
