import { contrastWithWhite } from '@leadflow/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CustomColors } from './CustomColors';

describe('custom colours (D-083)', () => {
  it('applies readable colours, and offers a fix for a main colour too light for white text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomColors value={{ primary: '#1d4ed8', accent: '#f59e0b' }} onChange={onChange} />);
    const code = screen.getByLabelText('צבע ראשי (כפתורים וכותרות), קוד');

    await user.clear(code);
    await user.type(code, '#ffd166');
    expect(screen.getByRole('alert')).toHaveTextContent('בהיר מדי');
    expect(onChange).not.toHaveBeenCalled(); // never applied while unreadable

    await user.click(screen.getByRole('button', { name: 'התאמה לגוון כהה יותר' }));
    const fixed = onChange.mock.calls.at(-1)![0];
    expect(contrastWithWhite(fixed.primary)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.accent).toBe('#f59e0b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
