import { useCallback, useState } from 'react';

const PREFIX = 'simplecatch.collapsed.';

/**
 * Whether a part of a screen is folded away, remembered in this browser. Storage can be missing or
 * blocked (private windows): then it simply starts open each time.
 */
export function useCollapsed(key: string, initial = false): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(PREFIX + key);
      return saved === null ? initial : saved === '1';
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(PREFIX + key, c ? '0' : '1');
      } catch {
        // Not remembered; the toggle still works.
      }
      return !c;
    });
  }, [key]);
  return [collapsed, toggle];
}
