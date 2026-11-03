import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setLocaleForTests } from './i18n';

afterEach(() => cleanup());

// Existing tests assert the Hebrew copy; English tests switch with setLocaleForTests('en').
setLocaleForTests('he');
beforeEach(() => setLocaleForTests('he'));

// Editors may flush a last save on unmount; once a test's mocked API is gone that save fails and
// leaves a local draft backup. Start every test with clean storage.
beforeEach(() => {
  localStorage.clear();
  // The product tour opens on first entry; tests that cover it remove this flag.
  localStorage.setItem('leadflow.tour.off', '1');
  // Likewise the helper's hello (D-105); its own test turns it back on.
  localStorage.setItem('leadflow.helper.quiet', '1');
  sessionStorage.clear();
});
