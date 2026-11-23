import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'adapter-browser',
    environment: 'jsdom',
    globals: false,
  },
});
