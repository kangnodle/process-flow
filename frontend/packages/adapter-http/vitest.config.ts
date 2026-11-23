import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'adapter-http',
    environment: 'node',
    globals: false,
  },
});
