import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

afterEach(() => cleanup());

// Editors may flush a last save on unmount; once a test's mocked API is gone that save fails and
// leaves a local draft backup. Start every test with clean storage.
beforeEach(() => localStorage.clear());
