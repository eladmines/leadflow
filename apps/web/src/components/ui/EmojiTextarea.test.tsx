import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EmojiTextarea } from './EmojiTextarea';

function Box() {
  const [value, setValue] = useState('שלום עולם');
  return <EmojiTextarea label="הודעה" value={value} onValueChange={setValue} />;
}

describe('EmojiTextarea', () => {
  it('has the emoji button inside the box, and inserts an emoji where the cursor is', async () => {
    const user = userEvent.setup();
    render(<Box />);
    const box = screen.getByLabelText<HTMLTextAreaElement>('הודעה');
    const button = screen.getByRole('button', { name: 'הוספת אימוג׳י' });
    // Inside the box's own frame, not a line of its own under it.
    expect(box.parentElement).toContainElement(button);
    expect(screen.queryByRole('group', { name: 'אימוג׳י' })).not.toBeInTheDocument();
    box.setSelectionRange(4, 4);
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'הוספת 😊' }));
    expect(box.value).toBe('שלום😊 עולם');
    // Typing still works, and Escape closes the grid.
    await user.type(box, '!');
    expect(box.value).toContain('!');
    await user.click(screen.getByRole('button', { name: 'הוספת 🙏' }));
    await user.keyboard('{Escape}');
  });
});
