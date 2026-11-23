export const seedProjectDescription = 'Created by Process Flow k6 seed.js (v1)';

export function benchmarkRunDescription() {
  const runId = __ENV.BENCH_RUN_ID;
  if (runId === undefined) return undefined;
  if (!/^[a-zA-Z0-9]{10,32}$/.test(runId)) throw new Error('Invalid BENCH_RUN_ID');
  return `Created by Process Flow k6 benchmark run ${runId}`;
}
