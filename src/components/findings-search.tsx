import { useState } from "react";
import { Search } from "lucide-react";

export function FindingsSearch({
  label = "Search findings",
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Mirror the insertion point for browsers without native block carets.
  const [caret, setCaret] = useState<{ index: number; scroll: number } | null>(
    null,
  );
  function syncCaret(input: HTMLInputElement) {
    if (CSS.supports("caret-shape", "block")) return;
    const index = input.selectionStart;
    setCaret(
      index !== null &&
        index === input.selectionEnd &&
        input === document.activeElement
        ? { index, scroll: input.scrollLeft }
        : null,
    );
  }
  const placeholder = `${label}…`;
  const text = value || placeholder;
  return (
    <label className="flex min-w-32 flex-1 items-center gap-2">
      <Search size={15} aria-hidden="true" />
      <span className="relative min-w-0 flex-1">
        <input
          type="search"
          className="findings-search w-full px-1 py-1 focus:outline-none"
          data-mirror={caret !== null || undefined}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            syncCaret(event.currentTarget);
          }}
          onFocus={(event) => syncCaret(event.currentTarget)}
          onSelect={(event) => syncCaret(event.currentTarget)}
          onScroll={(event) => syncCaret(event.currentTarget)}
          onBlur={() => setCaret(null)}
        />
        {caret && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 overflow-hidden whitespace-pre"
          >
            <span
              className="inline-block"
              style={{ transform: `translateX(-${caret.scroll}px)` }}
            >
              <span className="invisible">{value.slice(0, caret.index)}</span>
              <span className="findings-caret">
                {Array.from(text.slice(caret.index))[0] || "\u00a0"}
              </span>
            </span>
          </span>
        )}
      </span>
    </label>
  );
}
