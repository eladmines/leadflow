import { Smile } from 'lucide-react';
import { useId, useState, type RefObject } from 'react';
import { tr } from '../../i18n';

/** Emojis a small business uses most in customer messages (no library, no search). */
const EMOJIS = [
  '😊',
  '😀',
  '😍',
  '🥰',
  '😉',
  '🙏',
  '👍',
  '👋',
  '❤️',
  '💖',
  '✨',
  '🌟',
  '⭐',
  '🔥',
  '🎉',
  '🥳',
  '💐',
  '🌸',
  '💇‍♀️',
  '💅',
  '💄',
  '✂️',
  '🎵',
  '🎧',
  '📸',
  '📅',
  '⏰',
  '📍',
  '📞',
  '💬',
  '✅',
  '👇',
];

/**
 * "Add emoji": a small grid that opens under a text box and inserts at the cursor, keeping the
 * cursor after the emoji. `onInsert` gets the whole new value.
 */
export function EmojiPicker({
  target,
  value,
  onInsert,
}: {
  target: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onInsert: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const insert = (emoji: string) => {
    const el = target.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onInsert(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <Smile aria-hidden className="h-4 w-4" />
        {tr('הוספת אימוג׳י')}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={tr('אימוג׳י')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          className="grid w-fit grid-cols-8 gap-1 rounded-xl border border-surface-border bg-surface p-2 shadow-card"
        >
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={tr('הוספת {0}', emoji)}
              onClick={() => insert(emoji)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
