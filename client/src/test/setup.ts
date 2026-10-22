import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Use jsdom's browser storage, not Node's experimental global localStorage.
beforeEach(() => { vi.stubGlobal('localStorage', window.localStorage); });

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
