import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type SelectHTMLAttributes,
} from 'react';
import { SelectMenu } from './SelectMenu';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: string;
  options: readonly { value: string; label: string }[];
  /** Shown while nothing is selected. */
  placeholder?: string;
  hint?: string;
  error?: string;
  /** The small version for toolbars and rows. */
  compact?: boolean;
  /** The label is only for screen readers. */
  labelHidden?: boolean;
}

// The native setter: it works on any select (jsdom wraps selects in a proxy, so no own property is added).
const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

/**
 * A dropdown that opens right under its field (our own menu, not the operating system's, so it looks
 * and behaves the same everywhere), and still works wherever a native `<select>` did: `register()`
 * from react-hook-form, `value` + `onChange(e)`, `defaultValue`, `name`, `disabled`.
 *
 * How: a hidden native `<select>` stays the form's control (the ref, the value, the change and blur
 * events); the visible menu chooses a value on it and dispatches the same events a person's choice
 * would. A value written from outside (`reset()` setting `ref.value`) is picked up on the next render.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    hint,
    error,
    id,
    required,
    className,
    compact,
    labelHidden,
    name,
    value,
    defaultValue,
    disabled,
    onChange,
    onBlur,
    children: _children,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const buttonId = id ?? autoId;
  const native = useRef<HTMLSelectElement | null>(null);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(String(value ?? defaultValue ?? ''));
  const shown = controlled ? String(value) : inner;

  // Our ref and the caller's (react-hook-form's).
  const setRefs = useCallback(
    (el: HTMLSelectElement | null) => {
      native.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  // A value written from outside (react-hook-form's reset() or a default setting `ref.value`) is
  // picked up after the render that follows it, and shown.
  // On every render on purpose: the write itself triggers none of ours.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const v = native.current?.value;
    if (!controlled && v !== undefined && v !== inner) setInner(v);
  });

  const choose = (next: string) => {
    const el = native.current;
    if (!el || !valueDescriptor?.set) return;
    valueDescriptor.set.call(el, next);
    setInner(next);
    // The same event a choice in a native select fires, for onChange and for react-hook-form.
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const blurred = () => {
    native.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };

  return (
    <>
      <SelectMenu
        id={buttonId}
        label={label}
        options={options}
        value={shown}
        onChange={choose}
        onBlur={blurred}
        placeholder={placeholder}
        hint={hint}
        error={error}
        required={required}
        disabled={disabled}
        compact={compact}
        labelHidden={labelHidden}
        className={className}
      />
      <select
        ref={setRefs}
        name={name}
        aria-hidden
        tabIndex={-1}
        className="sr-only"
        disabled={disabled}
        {...(controlled ? { value } : { defaultValue })}
        onChange={onChange}
        onBlur={onBlur as ((e: FocusEvent<HTMLSelectElement>) => void) | undefined}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
});
