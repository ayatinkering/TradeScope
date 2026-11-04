'use client';

import { useEffect, useState } from 'react';
import { createMarketStream, PUBLISH_MS } from '@/lib/market-stream';

const endpoint = process.env.NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL;
const apiKey = process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

export function useCoinGeckoWebSocket({ coinId, poolId, liveInterval }: UseCoinGeckoWebSocketProps) {
  const [snapshot, setSnapshot] = useState(() => createMarketStream().snapshot());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const stream = createMarketStream();
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = INITIAL_RETRY_MS;
    let stopped = false;
    let dirty = false;
    const reset = setTimeout(() => {
      setSnapshot(stream.snapshot());
      setIsConnected(false);
    }, 0);

    const subscriptions = new Map<string, Record<string, unknown>>([
      ['CGSimplePrice', { coin_id: [coinId], action: 'set_tokens' }],
    ]);
    if (poolId) {
      const pools = { 'network_id:pool_addresses': [poolId.replace('_', ':')], action: 'set_pools' };
      subscriptions.set('OnchainTrade', pools);
      subscriptions.set('OnchainOHLCV', { ...pools, interval: liveInterval });
    }

    function connect() {
      if (!endpoint || !apiKey || stopped) return;
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        return;
      }
      if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return;
      url.searchParams.set('x_cg_pro_api_key', apiKey);
      const connection = new WebSocket(url);
      socket = connection;
      const send = (payload: Record<string, unknown>) => connection.send(JSON.stringify(payload));

      connection.onopen = () => {
        if (stopped) return;
        setIsConnected(true);
        for (const channel of subscriptions.keys()) {
          send({ command: 'subscribe', identifier: JSON.stringify({ channel }) });
        }
      };

      connection.onmessage = ({ data }) => {
        if (stopped || typeof data !== 'string') return;
        const result = stream.ingest(data);
        if (result === 'update') {
          dirty = true;
          delay = INITIAL_RETRY_MS;
          return;
        }
        if (result === 'ping') {
          send({ type: 'pong' });
          return;
        }

        try {
          const message = JSON.parse(data) as WebSocketMessage;
          if (message?.type !== 'confirm_subscription' || !message.identifier) return;
          const { channel } = JSON.parse(message.identifier);
          const settings = subscriptions.get(channel);
          if (settings) {
            send({ command: 'message', identifier: message.identifier, data: JSON.stringify(settings) });
          }
        } catch {
          // Ignore malformed control frames.
        }
      };

      connection.onclose = () => {
        if (stopped) return;
        setIsConnected(false);
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      };
      connection.onerror = () => connection.close();
    }

    const publish = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setSnapshot(stream.snapshot());
    }, PUBLISH_MS);
    connect();

    return () => {
      stopped = true;
      clearTimeout(reset);
      clearTimeout(retry);
      clearInterval(publish);
      socket?.close();
    };
  }, [coinId, poolId, liveInterval]);

  return { ...snapshot, isConnected };
}
