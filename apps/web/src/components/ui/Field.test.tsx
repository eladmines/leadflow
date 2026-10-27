import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';

describe('Field', () => {
  it('associates the label, and exposes the error to assistive tech', () => {
    render(<Field label="דוא״ל" error="כתובת לא תקינה" ltr />);
    const input = screen.getByLabelText('דוא״ל');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('כתובת לא תקינה');
    expect(input).toHaveAttribute('dir', 'ltr');
  });

  it('shows the hint when there is no error', () => {
    render(<Field label="שם העסק" hint="כפי שיופיע באתר" />);
    expect(screen.getByLabelText('שם העסק')).toHaveAccessibleDescription('כפי שיופיע באתר');
  });
});
