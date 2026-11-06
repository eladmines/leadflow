import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PhoneField } from './PhoneField';

function Harness({ initial = '', onValue }: { initial?: string; onValue: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneField
      label="טלפון"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

describe('PhoneField (D-121)', () => {
  it('sends the number with the chosen country code', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    await user.selectOptions(screen.getByLabelText('קידומת מדינה'), 'GB');
    await user.type(screen.getByLabelText('טלפון'), '07700 900123');
    expect(last).toBe('+44 07700 900123');
    // What was typed stays as typed.
    expect(screen.getByLabelText('טלפון')).toHaveValue('07700 900123');
  });

  it('defaults to Israel and keeps local Israeli numbers', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    expect(screen.getByLabelText('קידומת מדינה')).toHaveValue('IL');
    await user.type(screen.getByLabelText('טלפון'), '050-1234567');
    expect(last).toBe('+972 050-1234567');
  });

  it('opens a saved number in its own country', () => {
    render(<Harness initial="+447700900123" onValue={() => {}} />);
    expect(screen.getByLabelText('קידומת מדינה')).toHaveValue('GB');
    expect(screen.getByLabelText('טלפון')).toHaveValue('7700900123');
  });

  it('a full number pasted with its code switches the country', async () => {
    const user = userEvent.setup();
    let last = '';
    render(<Harness onValue={(v) => (last = v)} />);
    await user.click(screen.getByLabelText('טלפון'));
    await user.paste('+1 212 555 0199');
    expect(last).toBe('+1 212 555 0199');
    expect(screen.getByLabelText('קידומת מדינה')).toHaveValue('US');
  });

  it('clearing the number empties the value', async () => {
    const user = userEvent.setup();
    let last = 'x';
    render(<Harness initial="+972501234567" onValue={(v) => (last = v)} />);
    await user.clear(screen.getByLabelText('טלפון'));
    expect(last).toBe('');
  });
});
