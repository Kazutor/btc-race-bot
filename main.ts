// BTC dip-buy mean-reversion bot for make.fun btc-race-24h-20261117-0603.
// Long only, full size, very few trades: a full round trip costs ~26-37 bps
// in fees/slippage/impact, so it only trades when the expected move is larger.
//
// Rules (decided on a bar's close, filled at the next bar's open):
// - Buy when the close is at least 0.8% below the 60-bar SMA of closes.
// - Sell when the close is back above SMA60 + 1.5%, or +1.5% over entry,
//   or -1.5% under entry (stop).
// - At least 60 bars between a sell and the next buy, to stop whipsaw.
// - No clock, no randomness, no network: pure function of the bars seen.
import { runBars, type BarsState } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_BARS = 60;
const DIP_BPS = 80; // 0.8% below SMA to buy
const TAKE_BPS = 150; // 1.5% above SMA to sell
const WIN_BPS = 150; // 1.5% over entry to sell
const STOP_BPS = 150; // 1.5% under entry to sell
const COOLDOWN_BARS = 60;
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];
let entryPrice = 0;
let lastSellSeq = -1000000;

function sma(n: number): number | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

await runBars({
  onBatch(state: BarsState, batch) {
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    // Price in USDC: price_scale is 5, so c / 1e5.
    const close = Number(bar.c) / 100000;
    closes.push(close);
    const avg = sma(SMA_BARS);
    if (avg === null) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      void value;
      const up = close > avg * (1 + TAKE_BPS / 10000);
      const win = entryPrice > 0 && close > entryPrice * (1 + WIN_BPS / 10000);
      const stop = entryPrice > 0 && close < entryPrice * (1 - STOP_BPS / 10000);
      if (up || win || stop) {
        lastSellSeq = batch.seq;
        entryPrice = 0;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    // In cash: buy the dip, respecting the cooldown after a sell.
    if (batch.seq - lastSellSeq < COOLDOWN_BARS) return [];
    if (close < avg * (1 - DIP_BPS / 10000)) {
      const cash = state.cash;
      if (cash <= 0n) return [];
      entryPrice = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
