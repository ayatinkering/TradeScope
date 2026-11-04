export const TRADE_LIMIT = 256;
export const CANDLE_LIMIT = 2048;
export const PUBLISH_MS = 100;

export function createMarketStream() {
  const trades: Trade[] = [];
  const candles = new Map<number, OHLCData>();
  let tradeIndex = 0;
  let price: ExtendedPriceData | null = null;

  return {
    ingest(raw: string): 'ping' | 'update' | 'ignore' {
      let message: WebSocketMessage | null;
      try {
        message = JSON.parse(raw);
      } catch {
        return 'ignore';
      }
      if (!message) return 'ignore';
      if (message.type === 'ping') return 'ping';

      if (message.c === 'C1' && typeof message.p === 'number') {
        price = { usd: message.p, change24h: message.pp };
      } else if (message.c === 'G2' && Number.isFinite(message.t)) {
        trades[tradeIndex] = {
          price: message.pu, value: message.vo, timestamp: message.t ?? 0,
          type: message.ty, amount: message.to,
        };
        tradeIndex = (tradeIndex + 1) % TRADE_LIMIT;
      } else if (message.ch === 'G3') {
        const values = [message.t, message.o, message.h, message.l, message.c];
        if (values.some((value) => value == null || value === '' || !Number.isFinite(Number(value)))) {
          return 'ignore';
        }
        const candle = values.map(Number) as OHLCData;
        candles.set(candle[0], candle);
        if (candles.size > CANDLE_LIMIT) {
          const oldest = candles.keys().next().value;
          if (oldest !== undefined) candles.delete(oldest);
        }
      } else {
        return 'ignore';
      }
      return 'update';
    },
    snapshot() {
      return {
        price,
        trades: [...trades.slice(tradeIndex), ...trades.slice(0, tradeIndex)].reverse(),
        candles: Array.from(candles.values()),
      };
    },
  };
}

export function reconcileCandles(history: OHLCData[], live: OHLCData[]): OHLCData[] {
  const candles = new Map<number, OHLCData>();
  for (const [milliseconds, open, high, low, close] of history) {
    const seconds = Math.floor(milliseconds / 1000);
    candles.set(seconds, [seconds, open, high, low, close]);
  }
  for (const candle of live) candles.set(candle[0], candle);
  return Array.from(candles.values()).sort((left, right) => left[0] - right[0]);
}
