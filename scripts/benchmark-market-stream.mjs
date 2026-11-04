import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CANDLE_LIMIT, TRADE_LIMIT, createMarketStream, reconcileCandles } from '../lib/market-stream.ts';

const eventCount = 1_000_000;
const batchSize = 1000;
const epoch = 1_700_000_000;
const frames = Array.from({ length: 12_000 }, (_, index) => {
  const t = epoch + Math.floor(index / 6);
  if (index % 3 === 0) return JSON.stringify({ c: 'C1', p: 100 + index, t });
  if (index % 3 === 1) return JSON.stringify({ c: 'G2', pu: 100, to: 2, vo: 200, t, ty: 'b' });
  return JSON.stringify({ ch: 'G3', t, o: 100, h: 110, l: 90, c: 105 });
});
const stream = createMarketStream();
assert.equal(stream.ingest('{'), 'ignore');
assert.equal(stream.ingest('null'), 'ignore');
assert.equal(stream.ingest('{"type":"ping"}'), 'ping');
assert.equal(stream.ingest('{"ch":"G3","t":2,"o":100}'), 'ignore');

for (const frame of frames) stream.ingest(frame);
for (let index = 0; index <= CANDLE_LIMIT; index++) {
  stream.ingest(JSON.stringify({ ch: 'G3', t: epoch + index, o: 100, h: 110, l: 90, c: 105 }));
}
const snapshot = stream.snapshot();
assert.equal(snapshot.trades.length, TRADE_LIMIT);
assert.equal(snapshot.candles.length, CANDLE_LIMIT);
assert.equal(snapshot.candles[0][0], epoch + 1);
assert.deepEqual(reconcileCandles([[epoch * 1000, 1, 2, 0, 1]], [[epoch, 3, 4, 2, 3]]),
  [[epoch, 3, 4, 2, 3]]);

for (let run = 1; run <= 3; run++) {
  const replay = createMarketStream();
  const samples = [];
  const start = performance.now();
  for (let offset = 0; offset < eventCount; offset += batchSize) {
    const batchStart = performance.now();
    for (let index = offset; index < offset + batchSize; index++) {
      if (replay.ingest(frames[index % frames.length]) !== 'update') {
        throw new Error('Unexpected rejected replay event');
      }
    }
    samples.push(performance.now() - batchStart);
  }
  const elapsed = performance.now() - start;
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({
    run, events: eventCount, eventsPerSecond: Math.round(eventCount / (elapsed / 1000)),
    p95MsPer1000Events: Number(samples[Math.ceil(samples.length * 0.95) - 1].toFixed(3)),
  }));
}
