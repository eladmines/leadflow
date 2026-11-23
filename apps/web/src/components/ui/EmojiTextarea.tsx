import { Smile } from 'lucide-react';
import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { tr } from '../../i18n';
import { Textarea } from './Textarea';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

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
 * A text box with an emoji button inside its corner (a smiley, like a chat app). The grid opens under
 * the box and inserts at the cursor, keeping the cursor after the emoji. `onValueChange` gets the
 * whole new value, typed or inserted.
 */
export function EmojiTextarea({
  value,
  onValueChange,
  ...rest
}: Omit<TextareaProps, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const insert = (emoji: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onValueChange(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  return (
    <Textarea
      {...rest}
      ref={box}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      adornment={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={tr('הוספת אימוג׳י')}
          title={tr('הוספת אימוג׳י')}
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Smile aria-hidden className="h-5 w-5" />
        </button>
      }
      below={
        open && (
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
        )
      }
    />
  );
}
