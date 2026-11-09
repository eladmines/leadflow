import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EmojiPicker } from './EmojiPicker';

function Box() {
  const [value, setValue] = useState('שלום עולם');
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea
        aria-label="הודעה"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <EmojiPicker target={ref} value={value} onInsert={setValue} />
    </>
  );
}

describe('EmojiPicker', () => {
  it('opens and inserts an emoji where the cursor is', async () => {
    const user = userEvent.setup();
    render(<Box />);
    const box = screen.getByLabelText<HTMLTextAreaElement>('הודעה');
    box.setSelectionRange(4, 4);
    await user.click(screen.getByRole('button', { name: 'הוספת אימוג׳י' }));
    await user.click(screen.getByRole('button', { name: 'הוספת 😊' }));
    expect(box.value).toBe('שלום😊 עולם');
  });
});
