import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';
import { SelectMenu } from './SelectMenu';

const roles = [
  { value: 'EMPLOYEE', label: 'עובד/ת' },
  { value: 'MANAGER', label: 'מנהל/ת צוות' },
];

function Controlled() {
  const [value, setValue] = useState('EMPLOYEE');
  return (
    <>
      <Select
        label="תפקיד"
        options={roles}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <output aria-label="נבחר">{value}</output>
    </>
  );
}

function Form({ onSubmit }: { onSubmit: (v: { role: string }) => void }) {
  const form = useForm({ defaultValues: { role: 'MANAGER' } });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Select label="תפקיד" options={roles} {...form.register('role')} />
      <button type="submit">שליחה</button>
      <button type="button" onClick={() => form.reset({ role: 'EMPLOYEE' })}>
        איפוס
      </button>
    </form>
  );
}

describe('Select (our own menu, wherever a native select was)', () => {
  it('opens under the field, marks the chosen option, and reports a choice like a native select', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'תפקיד' });
    expect(box).toHaveTextContent('עובד/ת');
    await user.click(box);
    const chosen = screen.getByRole('option', { name: 'עובד/ת' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'מנהל/ת צוות' }));
    expect(screen.getByLabelText('נבחר')).toHaveTextContent('MANAGER');
    expect(box).toHaveTextContent('מנהל/ת צוות');
    // The list closes once chosen.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('works with react-hook-form: default shown, choice submitted, reset shown', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<Form onSubmit={submit} />);
    const box = screen.getByRole('combobox', { name: 'תפקיד' });
    expect(box).toHaveTextContent('מנהל/ת צוות');
    await user.click(screen.getByRole('button', { name: 'איפוס' }));
    expect(box).toHaveTextContent('עובד/ת');
    await user.click(box);
    await user.click(screen.getByRole('option', { name: 'מנהל/ת צוות' }));
    await user.click(screen.getByRole('button', { name: 'שליחה' }));
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0]).toEqual({ role: 'MANAGER' });
  });

  it('is keyboard friendly: arrows move, Enter picks, Escape closes', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'תפקיד' });
    box.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByLabelText('נבחר')).toHaveTextContent('MANAGER');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('a disabled one does not open', async () => {
    const user = userEvent.setup();
    render(<Select label="תפקיד" options={roles} defaultValue="EMPLOYEE" disabled />);
    const box = screen.getByRole('combobox', { name: 'תפקיד' });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('SelectMenu: compact, hidden label, and which way it opens', () => {
  const options = [
    { value: '', label: 'כל השלבים' },
    { value: 'a', label: 'נוצר קשר' },
  ];

  it('a hidden label still names the control for screen readers', () => {
    render(
      <SelectMenu
        compact
        labelHidden
        label="סינון לפי שלב"
        options={options}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'סינון לפי שלב' })).toHaveTextContent('כל השלבים');
    expect(screen.getByText('סינון לפי שלב')).toHaveClass('sr-only');
  });

  it('a short list opens downwards whenever it fits below, even near the bottom; a tall one flips', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getBoundingClientRect;
    // 768px-high window; the field ends 140px above the bottom edge, with more room above.
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ top: 560, bottom: 628, left: 0, right: 100, width: 100, height: 32 }) as DOMRect;
    try {
      // Two options need about 100px: they fit below, so the menu does not jump upwards.
      const small = render(
        <SelectMenu label="שלב" options={options} value="" onChange={() => {}} />,
      );
      await user.click(screen.getByRole('combobox', { name: 'שלב' }));
      expect(screen.getByRole('listbox').parentElement).toHaveClass('top-full');
      small.unmount();
      // Seven options need about 290px: they do not, and there is more room above.
      const many = Array.from({ length: 7 }, (_, i) => ({
        value: String(i),
        label: `אפשרות ${i}`,
      }));
      render(<SelectMenu label="שלב" options={many} value="" onChange={() => {}} />);
      await user.click(screen.getByRole('combobox', { name: 'שלב' }));
      expect(screen.getByRole('listbox').parentElement).toHaveClass('bottom-full');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it('never scrolls the page: not when it opens, not when the pointer moves over the options', async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<SelectMenu label="שלב" options={options} value="a" onChange={() => {}} />);
      await user.click(screen.getByRole('combobox', { name: 'שלב' }));
      await user.hover(screen.getByRole('option', { name: 'כל השלבים' }));
      await user.hover(screen.getByRole('option', { name: 'נוצר קשר' }));
      await user.keyboard('{ArrowUp}');
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('opens downwards by default, and upwards near the bottom of the screen', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <SelectMenu label="שלב" options={options} value="" onChange={() => {}} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'שלב' }));
    expect(screen.getByRole('listbox').parentElement).toHaveClass('top-full');
    unmount();

    // A button near the bottom edge of a 768px-high window, with more room above than below.
    const box = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ top: 680, bottom: 712, left: 0, right: 100, width: 100, height: 32 }) as DOMRect;
    try {
      render(<SelectMenu label="שלב" options={options} value="" onChange={() => {}} />);
      await user.click(screen.getByRole('combobox', { name: 'שלב' }));
      expect(screen.getByRole('listbox').parentElement).toHaveClass('bottom-full');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = box;
    }
  });
});
