import { EventEmitter } from "events";
import { BinanceClient } from "./binanceClient.js";
import { BinancePriceFetcher } from "./binancePriceFetcher.js";

// ============================================================================
// SOVEREIGN X v38 FINAL — Multi-Mind + Coin Personality Engine
// ============================================================================
// 6 Specialized Minds:
//   1. Momentum   — Strong upward surges with volume confirmation
//   2. Reversal    — Oversold bounce detection with MACD crossover
//   3. Range       — Buy low / sell high in calm sideways markets
//   4. Scalp Long  — Quick long entries at support with trend filter
//   5. Scalp Short — Quick short entries at resistance with trend filter
//   6. Bear        — Strong downtrend shorting (very strict)
//
// Each coin has its own personality:
//   BTC  — King: patient, big targets, low leverage
//   ETH  — Follower: moderate, follows BTC trends
//   SOL  — Wild: fast mover, quick scalps, wide stops
//   BNB  — Stable: range specialist, consistent
//   XRP  — Explosive: waits for big moves, huge TP2
//   ADA  — Cautious: small positions, careful entries
//
// Risk Management:
//   - TP1: close 30% + move SL to break-even (free trade)
//   - TP2: close remaining 70% at big target
//   - Trailing stop after TP1
//   - Daily loss limit: -8% stops new trades
//   - Consecutive loss reduction: risk drops per loss streak
//   - Compound growth: risk scales UP with profits
//   - Max 5 simultaneous positions
//   - Cooldown per coin after loss
// ============================================================================

// ---- Coin Personality Profiles ----
interface CoinProfile {
  name: string;
  riskMult: number;
  levMult: number;
  slMult: number;
  tp1Mult: number;
  tp2Mult: number;
  minConf: number;
  cooldownMin: number;
  allowedMinds: string[];
}

const COIN_PROFILES: Record<string, CoinProfile> = {
  BTCUSDT: {
    name: "Bitcoin",
    riskMult: 0.8,
    levMult: 0.9,
    slMult: 1.0,
    tp1Mult: 1.5,
    tp2Mult: 2.0,
    minConf: 65,
    cooldownMin: 90,
    allowedMinds: ["momentum", "reversal", "scalp_long"],
  },
  ETHUSDT: {
    name: "Ethereum",
    riskMult: 1.0,
    levMult: 1.0,
    slMult: 1.0,
    tp1Mult: 1.3,
    tp2Mult: 1.5,
    minConf: 60,
    cooldownMin: 60,
    allowedMinds: ["momentum", "reversal", "range", "scalp_long", "scalp_short"],
  },
  SOLUSDT: {
    name: "Solana",
    riskMult: 1.3,
    levMult: 1.1,
    slMult: 1.3,
    tp1Mult: 1.0,
    tp2Mult: 2.0,
    minConf: 55,
    cooldownMin: 30,
    allowedMinds: ["momentum", "reversal", "scalp_long"],
  },
  BNBUSDT: {
    name: "BNB",
    riskMult: 0.9,
    levMult: 0.9,
    slMult: 1.0,
    tp1Mult: 1.0,
    tp2Mult: 1.5,
    minConf: 55,
    cooldownMin: 45,
    allowedMinds: ["range", "reversal", "momentum", "scalp_long", "scalp_short"],
  },
  XRPUSDT: {
    name: "XRP",
    riskMult: 1.2,
    levMult: 1.1,
    slMult: 0.8,
    tp1Mult: 1.0,
    tp2Mult: 2.5,
    minConf: 60,
    cooldownMin: 45,
    allowedMinds: ["momentum", "reversal", "scalp_long"],
  },
  ADAUSDT: {
    name: "ADA",
    riskMult: 0.8,
    levMult: 0.8,
    slMult: 1.2,
    tp1Mult: 1.0,
    tp2Mult: 1.5,
    minConf: 60,
    cooldownMin: 60,
    allowedMinds: ["range", "reversal", "scalp_long", "scalp_short"],
  },
};

// ---- Mind Configurations ----
interface MindConfig {
  name: string;
  side: "long" | "short" | "both";
  riskPct: number;
  levRange: [number, number];
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  trailPct: number;
  tp1ClosePct: number; // fraction of position to close at TP1
}

const MINDS: Record<string, MindConfig> = {
  momentum: {
    name: "Momentum",
    side: "long",
    riskPct: 0.15,
    levRange: [10, 20],
    slPct: 0.018,
    tp1Pct: 0.03,
    tp2Pct: 0.10,
    trailPct: 0.012,
    tp1ClosePct: 0.3,
  },
  reversal: {
    name: "Reversal",
    side: "long",
    riskPct: 0.15,
    levRange: [10, 18],
    slPct: 0.02,
    tp1Pct: 0.035,
    tp2Pct: 0.12,
    trailPct: 0.015,
    tp1ClosePct: 0.3,
  },
  range: {
    name: "Range",
    side: "both",
    riskPct: 0.10,
    levRange: [8, 15],
    slPct: 0.012,
    tp1Pct: 0.015,
    tp2Pct: 0.04,
    trailPct: 0.008,
    tp1ClosePct: 0.3,
  },
  scalp_long: {
    name: "Scalp Long",
    side: "long",
    riskPct: 0.10,
    levRange: [10, 18],
    slPct: 0.008,
    tp1Pct: 0.012,
    tp2Pct: 0.03,
    trailPct: 0.006,
    tp1ClosePct: 0.3,
  },
  scalp_short: {
    name: "Scalp Short",
    side: "short",
    riskPct: 0.08,
    levRange: [8, 14],
    slPct: 0.008,
    tp1Pct: 0.012,
    tp2Pct: 0.03,
    trailPct: 0.006,
    tp1ClosePct: 0.3,
  },
  bear: {
    name: "Bear",
    side: "short",
    riskPct: 0.10,
    levRange: [8, 15],
    slPct: 0.02,
    tp1Pct: 0.025,
    tp2Pct: 0.07,
    trailPct: 0.012,
    tp1ClosePct: 0.3,
  },
};

// ---- Incremental Indicator State per Symbol ----
interface IndicatorState {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  count: number;
  ema9: number | null;
  ema12: number | null;
  ema26: number | null;
  ema50: number | null;
  rsiAvgGain: number | null;
  rsiAvgLoss: number | null;
  macdHist: number[];
  macdSignal: number | null;
}

interface Indicators {
  price: number;
  e9: number;
  e12: number;
  e26: number;
  e50: number;
  rsi: number;
  adx: number;
  adxDir: number;
  atr: number;
  macdH: number;
  volRatio: number;
  mom5: number;
  mom10: number;
  bbPos: number;
  bbWidth: number;
  greenStreak: number;
  redStreak: number;
  macdCrossUp: boolean;
  aboveE9: boolean;
  aboveE50: boolean;
  e9AboveE26: boolean;
  rangePos: number;
}

// ---- Position tracking ----
interface ManagedPosition {
  symbol: string;
  side: "long" | "short";
  mind: string;
  entryPrice: number;
  quantity: number;
  leverage: number;
  sl: number;
  tp1: number;
  tp2: number;
  trailStop: number;
  trailPct: number;
  tp1ClosePct: number;
  confidence: number;
  tp1Hit: boolean;
  status: "open" | "partial" | "closed";
  margin: number;
  openTime: number;
  orderId: string;
  profit: number;
}

// ============================================================================
// MAIN ENGINE
// ============================================================================

export class TradingEngine extends EventEmitter {
  private isRunning = false;
  private balance = 0;
  private totalProfit = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private losingTrades = 0;
  private consecutiveLosses = 0;
  private symbols: Record<string, any> = {};
  private positions: Record<string, ManagedPosition | null> = {};
  private indicatorStates: Record<string, IndicatorState> = {};
  private cooldowns: Record<string, number> = {};
  private logs: string[] = [];
  private responseTimes: number[] = [];
  private lastUpdateTime = Date.now();
  private updateCount = 0;
  private dailyPnl = 0;
  private dailyStartBal = 0;
  private currentDay = "";
  private binanceClient: BinanceClient;
  private binanceFetcher: BinancePriceFetcher;
  private analysisInterval: any = null;
  private balanceInterval: any = null;
  private klineInterval: any = null;

  private readonly SYMBOL_LIST = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
  ];

  private readonly MAX_POSITIONS = 5;

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.binanceClient = new BinanceClient(apiKey, apiSecret);
    this.binanceFetcher = new BinancePriceFetcher();
    this.initializeSymbols();
  }

  // ---- Initialize all symbol data structures ----
  private initializeSymbols() {
    for (const symbol of this.SYMBOL_LIST) {
      this.symbols[symbol] = {
        symbol,
        price: 0,
        lastUpdateTime: Date.now(),
        positions: [] as any[],
        priceHistory: [] as number[],
        updateCount: 0,
        wsLatency: 0,
        klines: [] as any[],
      };
      this.positions[symbol] = null;
      this.indicatorStates[symbol] = {
        closes: [],
        highs: [],
        lows: [],
        volumes: [],
        count: 0,
        ema9: null,
        ema12: null,
        ema26: null,
        ema50: null,
        rsiAvgGain: null,
        rsiAvgLoss: null,
        macdHist: [],
        macdSignal: null,
      };
    }
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(logEntry);
    this.emit("log", logEntry);
  }

  // ============================================================================
  // START / STOP
  // ============================================================================

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.log("🚀 SOVEREIGN X v38 FINAL — Multi-Mind + Coin Personality Engine started!");
    this.log("🧠 6 Minds: Momentum | Reversal | Range | Scalp Long | Scalp Short | Bear");
    this.log("💱 6 Coins: BTC | ETH | BNB | SOL | XRP | ADA — each with unique personality");
    this.log("📡 Data: Binance Futures WebSocket (millisecond updates)");

    // Fetch initial balance
    try {
      const balances = await this.binanceClient.getBalance();
      const usdtBalance = balances["USDT"]?.free || 0;
      if (usdtBalance > 0) {
        this.balance = usdtBalance;
        this.log(`💰 Account Balance: $${this.balance.toFixed(2)} USDT`);
      } else {
        this.balance = 150;
        this.log(`💰 Default Balance: $${this.balance.toFixed(2)} USDT`);
      }
    } catch (error: any) {
      this.balance = 150;
      this.log(`⚠️ Balance fetch failed: ${error.message} — using $150 default`);
    }

    this.dailyStartBal = this.balance;
    this.currentDay = new Date().toISOString().slice(0, 10);

    // Connect WebSocket for real-time prices
    this.startWebSocketPriceFeed();

    // Fetch initial kline history for indicator warm-up
    await this.fetchInitialKlines();

    // Start analysis loop (every 3 seconds)
    this.startAnalysisLoop();

    // Start balance refresh (every 60 seconds)
    this.startBalanceRefresh();

    // Refresh klines every 60 seconds to keep candle data fresh
    this.startKlineRefresh();
  }

  async stop() {
    this.isRunning = false;
    this.binanceFetcher.disconnect();
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.balanceInterval) clearInterval(this.balanceInterval);
    if (this.klineInterval) clearInterval(this.klineInterval);
    this.log("🛑 SOVEREIGN X v38 stopped");
  }

  // ============================================================================
  // WEBSOCKET PRICE FEED
  // ============================================================================

  private startWebSocketPriceFeed() {
    this.binanceFetcher.on("priceUpdate", (data: any) => {
      const { symbol, price, latency } = data;
      if (this.symbols[symbol]) {
        this.symbols[symbol].price = price;
        this.symbols[symbol].lastUpdateTime = Date.now();
        this.symbols[symbol].wsLatency = latency;
        this.symbols[symbol].updateCount++;
      }
    });

    this.binanceFetcher.on("connected", () => {
      this.log("✅ WebSocket price feed connected — receiving real-time data");
    });

    this.binanceFetcher.connect(this.SYMBOL_LIST);
    this.log(`🔌 WebSocket connecting to ${this.SYMBOL_LIST.length} symbol streams...`);
  }

  // ============================================================================
  // KLINE DATA — for indicator calculations (OHLCV candles)
  // ============================================================================

  private async fetchInitialKlines() {
    this.log("📊 Fetching initial kline history for indicator warm-up...");
    for (const symbol of this.SYMBOL_LIST) {
      try {
        const klines = await this.binanceClient.getKlines(symbol, "1m", 200);
        if (klines && klines.length > 0) {
          this.symbols[symbol].klines = klines;
          // Warm up indicator state with historical candles
          const state = this.indicatorStates[symbol];
          for (const k of klines) {
            state.closes.push(k.close);
            state.highs.push(k.high);
            state.lows.push(k.low);
            state.volumes.push(k.volume);
            state.count++;
          }
          // Trim to 300 max
          if (state.closes.length > 300) {
            state.closes = state.closes.slice(-300);
            state.highs = state.highs.slice(-300);
            state.lows = state.lows.slice(-300);
            state.volumes = state.volumes.slice(-300);
          }
          this.log(`  ${COIN_PROFILES[symbol].name}: ${klines.length} candles loaded`);
        }
      } catch (error: any) {
        this.log(`  ⚠️ ${symbol} kline fetch failed: ${error.message}`);
      }
    }
    this.log("📊 Indicator warm-up complete");
  }

  private startKlineRefresh() {
    this.klineInterval = setInterval(async () => {
      if (!this.isRunning) return;
      for (const symbol of this.SYMBOL_LIST) {
        try {
          const klines = await this.binanceClient.getKlines(symbol, "1m", 5);
          if (klines && klines.length > 0) {
            const state = this.indicatorStates[symbol];
            const lastKline = klines[klines.length - 1];
            // Only add if it's a new candle (different close time)
            const existingLast = this.symbols[symbol].klines?.slice(-1)[0];
            if (!existingLast || lastKline.openTime !== existingLast.openTime) {
              state.closes.push(lastKline.close);
              state.highs.push(lastKline.high);
              state.lows.push(lastKline.low);
              state.volumes.push(lastKline.volume);
              state.count++;
              if (state.closes.length > 300) {
                state.closes = state.closes.slice(-300);
                state.highs = state.highs.slice(-300);
                state.lows = state.lows.slice(-300);
                state.volumes = state.volumes.slice(-300);
              }
              this.symbols[symbol].klines.push(lastKline);
              if (this.symbols[symbol].klines.length > 200) {
                this.symbols[symbol].klines = this.symbols[symbol].klines.slice(-200);
              }
            } else {
              // Update the current candle's close price
              const idx = state.closes.length - 1;
              if (idx >= 0) {
                state.closes[idx] = lastKline.close;
                state.highs[idx] = Math.max(state.highs[idx], lastKline.high);
                state.lows[idx] = Math.min(state.lows[idx], lastKline.low);
                state.volumes[idx] = lastKline.volume;
              }
            }
          }
        } catch (_) {
          // Silent fail — will retry next cycle
        }
      }
    }, 60000);
  }

  // ============================================================================
  // BALANCE REFRESH
  // ============================================================================

  private startBalanceRefresh() {
    this.balanceInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const balances = await this.binanceClient.getBalance();
        const usdtBalance = balances["USDT"]?.free || 0;
        if (usdtBalance > 0) {
          this.balance = usdtBalance;
        }
      } catch (_) {
        // Silent — balance syncs from trade results
      }
    }, 60000);
  }

  // ============================================================================
  // INCREMENTAL INDICATOR CALCULATION
  // ============================================================================

  private emaIncr(prev: number | null, value: number, period: number): number {
    if (prev === null) return value;
    const m = 2 / (period + 1);
    return value * m + prev * (1 - m);
  }

  private calculateIndicators(symbol: string): Indicators | null {
    const s = this.indicatorStates[symbol];
    const c = s.closes;
    const h = s.highs;
    const l = s.lows;
    const v = s.volumes;

    if (c.length < 30) return null;

    const price = c[c.length - 1];

    // ---- EMAs (incremental) ----
    if (s.ema9 === null) {
      s.ema9 = c.slice(-9).reduce((a, b) => a + b, 0) / 9;
      s.ema12 = c.slice(-12).reduce((a, b) => a + b, 0) / 12;
      s.ema26 = c.slice(-26).reduce((a, b) => a + b, 0) / 26;
      s.ema50 = c.length >= 50
        ? c.slice(-50).reduce((a, b) => a + b, 0) / 50
        : s.ema26;
    } else {
      s.ema9 = this.emaIncr(s.ema9, price, 9);
      s.ema12 = this.emaIncr(s.ema12, price, 12);
      s.ema26 = this.emaIncr(s.ema26, price, 26);
      s.ema50 = this.emaIncr(s.ema50, price, 50);
    }

    // ---- RSI (incremental Wilder smoothing) ----
    let rsi = 50;
    if (c.length >= 15) {
      if (s.rsiAvgGain === null) {
        let gains = 0, losses = 0;
        for (let i = c.length - 14; i < c.length; i++) {
          const diff = c[i] - c[i - 1];
          if (diff > 0) gains += diff;
          else losses -= diff;
        }
        s.rsiAvgGain = gains / 14;
        s.rsiAvgLoss = losses / 14;
      } else {
        const diff = c[c.length - 1] - c[c.length - 2];
        s.rsiAvgGain = (s.rsiAvgGain! * 13 + Math.max(diff, 0)) / 14;
        s.rsiAvgLoss = (s.rsiAvgLoss! * 13 + Math.max(-diff, 0)) / 14;
      }
      rsi = s.rsiAvgLoss! > 0
        ? 100 - 100 / (1 + s.rsiAvgGain! / s.rsiAvgLoss!)
        : 100;
    }

    // ---- ATR% ----
    let atr = 0;
    if (c.length >= 15) {
      let trSum = 0;
      for (let i = c.length - 14; i < c.length; i++) {
        trSum += Math.max(
          h[i] - l[i],
          Math.abs(h[i] - c[i - 1]),
          Math.abs(l[i] - c[i - 1])
        );
      }
      atr = (trSum / 14 / price) * 100;
    }

    // ---- ADX (simplified) ----
    let adx = 20, adxDir = 0;
    if (c.length >= 30) {
      let plusSum = 0, minusSum = 0, trSum = 0;
      for (let i = c.length - 14; i < c.length; i++) {
        const hDiff = h[i] - h[i - 1];
        const lDiff = l[i - 1] - l[i];
        plusSum += hDiff > lDiff && hDiff > 0 ? hDiff : 0;
        minusSum += lDiff > hDiff && lDiff > 0 ? lDiff : 0;
        trSum += Math.max(
          h[i] - l[i],
          Math.abs(h[i] - c[i - 1]),
          Math.abs(l[i] - c[i - 1])
        );
      }
      if (trSum > 0) {
        const pdi = (plusSum / trSum) * 100;
        const mdi = (minusSum / trSum) * 100;
        if (pdi + mdi > 0) {
          adx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
          adxDir = pdi - mdi;
        }
      }
    }

    // ---- MACD Histogram ----
    let macdH = 0;
    if (s.count >= 30 && s.ema12 !== null && s.ema26 !== null) {
      const macdLine = s.ema12 - s.ema26;
      s.macdHist.push(macdLine);
      if (s.macdHist.length > 50) s.macdHist = s.macdHist.slice(-50);
      if (s.macdHist.length >= 9) {
        if (s.macdSignal === null) {
          s.macdSignal = s.macdHist.slice(-9).reduce((a, b) => a + b, 0) / 9;
        } else {
          s.macdSignal = this.emaIncr(s.macdSignal, macdLine, 9);
        }
        macdH = macdLine - s.macdSignal;
      }
    }

    // ---- Volume Ratio ----
    let volRatio = 1;
    if (v.length >= 21) {
      const avg = v.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      volRatio = avg > 0 ? v[v.length - 1] / avg : 1;
    }

    // ---- Momentum ----
    const mom5 = c.length >= 6 ? ((c[c.length - 1] - c[c.length - 6]) / c[c.length - 6]) * 100 : 0;
    const mom10 = c.length >= 11 ? ((c[c.length - 1] - c[c.length - 11]) / c[c.length - 11]) * 100 : 0;

    // ---- Bollinger Bands ----
    let bbPos = 0.5, bbWidth = 0;
    if (c.length >= 20) {
      const slice = c.slice(-20);
      const mean = slice.reduce((a, b) => a + b, 0) / 20;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
      if (std > 0) {
        const upper = mean + 2 * std;
        const lower = mean - 2 * std;
        bbPos = upper !== lower ? Math.max(0, Math.min(1, (price - lower) / (upper - lower))) : 0.5;
        bbWidth = (std / mean) * 100;
      }
    }

    // ---- Green/Red Streaks ----
    let greenStreak = 0, redStreak = 0;
    for (let i = 1; i < Math.min(8, c.length); i++) {
      if (c[c.length - i] > c[c.length - i - 1]) greenStreak++;
      else break;
    }
    for (let i = 1; i < Math.min(8, c.length); i++) {
      if (c[c.length - i] < c[c.length - i - 1]) redStreak++;
      else break;
    }

    // ---- Range Position ----
    const recentHigh = Math.max(...h.slice(-20));
    const recentLow = Math.min(...l.slice(-20));
    const rangePos = recentHigh !== recentLow
      ? (price - recentLow) / (recentHigh - recentLow)
      : 0.5;

    // ---- MACD Crossover ----
    const mh = s.macdHist;
    const macdCrossUp = mh.length >= 2 && mh[mh.length - 1] > 0 && mh[mh.length - 2] <= 0;

    return {
      price,
      e9: s.ema9!,
      e12: s.ema12!,
      e26: s.ema26!,
      e50: s.ema50!,
      rsi,
      adx,
      adxDir,
      atr,
      macdH,
      volRatio,
      mom5,
      mom10,
      bbPos,
      bbWidth,
      greenStreak,
      redStreak,
      macdCrossUp,
      aboveE9: price > s.ema9!,
      aboveE50: price > s.ema50!,
      e9AboveE26: s.ema9! > s.ema26!,
      rangePos,
    };
  }

  // ============================================================================
  // SIGNAL DETECTION — Check all allowed minds, pick best
  // ============================================================================

  private checkMindSignal(
    mind: string,
    ind: Indicators
  ): { side: "long" | "short" | null; confidence: number } {
    let side: "long" | "short" | null = null;
    let conf = 0;

    switch (mind) {
      case "momentum":
        // Strong upward momentum with volume confirmation
        if (
          ind.mom5 > 0.15 &&
          ind.volRatio > 1.3 &&
          ind.rsi >= 42 &&
          ind.rsi <= 78 &&
          ind.macdH > 0 &&
          ind.aboveE9
        ) {
          conf = Math.min(95, 50 + ind.mom5 * 10 + (ind.volRatio - 1.3) * 6 + ind.adx * 0.3);
          if (ind.macdCrossUp) conf += 10;
          if (ind.greenStreak >= 2) conf += 5;
          side = "long";
        }
        break;

      case "reversal":
        // Oversold bounce with MACD confirmation
        if (
          ind.rsi < 28 &&
          (ind.macdH > 0 || ind.macdCrossUp) &&
          ind.volRatio > 1.0 &&
          ind.greenStreak >= 1
        ) {
          conf = Math.min(90, 48 + (28 - ind.rsi) * 1.5 + (ind.volRatio - 1) * 5 + ind.greenStreak * 4);
          if (ind.bbPos < 0.1) conf += 8;
          side = "long";
        }
        break;

      case "range":
        // Buy at bottom of range
        if (ind.bbPos < 0.1 && ind.rsi < 30 && ind.atr < 0.5) {
          conf = Math.min(82, 48 + (30 - ind.rsi) * 1.0 + (0.1 - ind.bbPos) * 60);
          side = "long";
        }
        // Sell at top of range
        else if (ind.bbPos > 0.9 && ind.rsi > 70 && ind.atr < 0.5) {
          conf = Math.min(78, 45 + (ind.rsi - 70) * 0.8 + (ind.bbPos - 0.9) * 50);
          side = "short";
        }
        break;

      case "scalp_long":
        // Quick long at support with EMA50 filter
        if (
          ind.bbPos < 0.2 &&
          ind.rsi < 38 &&
          ind.macdH > 0 &&
          ind.aboveE50
        ) {
          conf = Math.min(80, 48 + (38 - ind.rsi) * 0.7 + (0.2 - ind.bbPos) * 30);
          side = "long";
        }
        break;

      case "scalp_short":
        // Quick short at resistance with EMA50 filter
        if (
          ind.bbPos > 0.8 &&
          ind.rsi > 62 &&
          ind.macdH < 0 &&
          !ind.aboveE50
        ) {
          conf = Math.min(78, 46 + (ind.rsi - 62) * 0.6 + (ind.bbPos - 0.8) * 30);
          side = "short";
        }
        break;

      case "bear":
        // Strong downtrend (very strict conditions)
        if (
          ind.adx > 28 &&
          !ind.e9AboveE26 &&
          ind.adxDir < 0 &&
          ind.rsi < 42 &&
          ind.macdH < 0 &&
          ind.mom10 < -0.3
        ) {
          conf = Math.min(82, 48 + ind.adx * 0.4 + Math.abs(ind.mom10) * 5);
          side = "short";
        }
        break;
    }

    return { side, confidence: conf };
  }

  private findBestSignal(
    symbol: string,
    ind: Indicators
  ): { mind: string | null; side: "long" | "short" | null; confidence: number } {
    const profile = COIN_PROFILES[symbol];
    if (!profile) return { mind: null, side: null, confidence: 0 };

    let bestMind: string | null = null;
    let bestSide: "long" | "short" | null = null;
    let bestConf = 0;

    for (const mindName of profile.allowedMinds) {
      const { side, confidence } = this.checkMindSignal(mindName, ind);
      if (side && confidence > bestConf) {
        bestMind = mindName;
        bestSide = side;
        bestConf = confidence;
      }
    }

    // Apply coin-specific minimum confidence
    if (bestConf < profile.minConf) {
      return { mind: null, side: null, confidence: 0 };
    }

    return { mind: bestMind, side: bestSide, confidence: bestConf };
  }

  // ============================================================================
  // ANALYSIS LOOP — Runs every 3 seconds
  // ============================================================================

  private startAnalysisLoop() {
    this.analysisInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const startTime = Date.now();

      // ---- Daily reset check ----
      const today = new Date().toISOString().slice(0, 10);
      if (today !== this.currentDay) {
        this.log(`📅 New day: ${today} | Yesterday PnL: $${this.dailyPnl.toFixed(2)}`);
        this.currentDay = today;
        this.dailyPnl = 0;
        this.dailyStartBal = this.balance;
      }

      // ---- Daily loss limit check ----
      const dayLossPct = this.dailyStartBal > 0
        ? ((this.balance - this.dailyStartBal) / this.dailyStartBal) * 100
        : 0;
      const dailyLocked = dayLossPct < -8;

      try {
        for (const symbol of this.SYMBOL_LIST) {
          // Always manage existing positions
          await this.managePosition(symbol);

          // Only look for new signals if not daily-locked
          if (!dailyLocked) {
            await this.checkForEntry(symbol);
          }
        }

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        this.responseTimes.push(responseTime);
        if (this.responseTimes.length > 100) this.responseTimes.shift();

        this.lastUpdateTime = endTime;
        this.updateCount++;
        this.emit("stats", this.getStats());

        // Log performance every 200 cycles (~10 minutes)
        if (this.updateCount % 200 === 0) {
          const avgTime =
            this.responseTimes.reduce((a, b) => a + b, 0) /
            this.responseTimes.length;

          const openCount = this.SYMBOL_LIST.filter(
            (s) => this.positions[s] !== null
          ).length;

          this.log(
            `⚡ Cycle ${this.updateCount} | Analysis: ${avgTime.toFixed(1)}ms | ` +
            `Balance: $${this.balance.toFixed(2)} | Open: ${openCount}/${this.MAX_POSITIONS} | ` +
            `W:${this.winningTrades} L:${this.losingTrades} | ` +
            `Day PnL: $${this.dailyPnl.toFixed(2)} (${dayLossPct.toFixed(1)}%)` +
            (dailyLocked ? " | ⛔ DAILY LIMIT" : "")
          );
        }
      } catch (error: any) {
        this.log(`❌ Analysis error: ${error.message}`);
      }
    }, 3000);
  }

  // ============================================================================
  // ENTRY LOGIC
  // ============================================================================

  private async checkForEntry(symbol: string) {
    // Skip if already in a position for this symbol
    if (this.positions[symbol] !== null) return;

    // Skip if in cooldown
    if (this.cooldowns[symbol] && Date.now() < this.cooldowns[symbol]) return;

    // Skip if max positions reached
    const openCount = this.SYMBOL_LIST.filter(
      (s) => this.positions[s] !== null
    ).length;
    if (openCount >= this.MAX_POSITIONS) return;

    // Calculate indicators
    const ind = this.calculateIndicators(symbol);
    if (!ind) return;

    // Find best signal across all allowed minds
    const { mind, side, confidence } = this.findBestSignal(symbol, ind);
    if (!mind || !side) return;

    const profile = COIN_PROFILES[symbol];
    const cfg = MINDS[mind];

    // ---- Calculate risk amount ----
    const lossReduction = Math.max(0.4, 1.0 - this.consecutiveLosses * 0.1);
    const growthMult = this.balance > 150 ? Math.min(1.8, this.balance / 150) : 1.0;
    let risk = this.balance * cfg.riskPct * profile.riskMult * lossReduction * growthMult;
    if (risk < 1) return;
    if (risk > this.balance * 0.15) risk = this.balance * 0.15; // Hard cap 15%

    // ---- Calculate leverage ----
    const [levMin, levMax] = cfg.levRange;
    let leverage = (levMin + (confidence / 100) * (levMax - levMin)) * profile.levMult;
    leverage = Math.min(leverage, 20); // Hard cap 20x
    leverage = Math.round(leverage);

    // ---- Calculate entry, SL, TP ----
    const slippage = 0.0003;
    const entryPrice = side === "long"
      ? ind.price * (1 + slippage)
      : ind.price * (1 - slippage);

    const slPct = cfg.slPct * profile.slMult;
    const tp1Pct = cfg.tp1Pct * profile.tp1Mult;
    const tp2Pct = cfg.tp2Pct * profile.tp2Mult;

    const sl = side === "long" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
    const tp1 = side === "long" ? entryPrice * (1 + tp1Pct) : entryPrice * (1 - tp1Pct);
    const tp2 = side === "long" ? entryPrice * (1 + tp2Pct) : entryPrice * (1 - tp2Pct);

    const quantity = (risk * leverage) / entryPrice;

    // ---- Execute on Binance ----
    const binanceSide = side === "long" ? "BUY" : "SELL";
    let orderId = `SIM-${Date.now()}`;

    try {
      const orderResult = await this.binanceClient.openPosition(
        symbol,
        binanceSide as "BUY" | "SELL",
        quantity,
        leverage
      );

      if (orderResult) {
        orderId = orderResult.orderId || orderId;

        // Set stop loss on Binance
        await this.binanceClient.setStopLoss(
          symbol,
          side === "long" ? "LONG" : "SHORT",
          sl
        );

        // Set TP1 on Binance (partial close)
        await this.binanceClient.setTakeProfit(
          symbol,
          side === "long" ? "LONG" : "SHORT",
          tp1,
          quantity * cfg.tp1ClosePct
        );
      }
    } catch (error: any) {
      this.log(`⚠️ Binance order error for ${symbol}: ${error.message} — tracking locally`);
    }

    // ---- Track position locally ----
    const position: ManagedPosition = {
      symbol,
      side,
      mind,
      entryPrice,
      quantity,
      leverage,
      sl,
      tp1,
      tp2,
      trailStop: sl,
      trailPct: cfg.trailPct,
      tp1ClosePct: cfg.tp1ClosePct,
      confidence,
      tp1Hit: false,
      status: "open",
      margin: risk,
      openTime: Date.now(),
      orderId,
      profit: 0,
    };

    this.positions[symbol] = position;
    this.totalTrades++;

    // Also store in symbols for API compatibility
    this.symbols[symbol].positions = [position];

    this.log(
      `⚡ OPEN ${side.toUpperCase()} ${symbol} | ${cfg.name} Mind | ` +
      `Entry: $${entryPrice.toFixed(4)} | ${leverage}x | ` +
      `Risk: $${risk.toFixed(2)} | Conf: ${confidence.toFixed(0)}% | ` +
      `SL: $${sl.toFixed(4)} | TP1: $${tp1.toFixed(4)} | TP2: $${tp2.toFixed(4)}`
    );
  }

  // ============================================================================
  // POSITION MANAGEMENT — TP1, TP2, SL, Trailing
  // ============================================================================

  private async managePosition(symbol: string) {
    const pos = this.positions[symbol];
    if (!pos || pos.status === "closed") return;

    const currentPrice = this.symbols[symbol].price;
    if (!currentPrice || currentPrice === 0) return;

    const profile = COIN_PROFILES[symbol];

    // ---- Calculate current PnL ----
    const priceDiff = pos.side === "long"
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    const remainingQty = pos.tp1Hit ? pos.quantity * (1 - pos.tp1ClosePct) : pos.quantity;
    pos.profit = remainingQty * priceDiff;

    // ---- Check Stop Loss ----
    const effectiveSL = pos.tp1Hit ? pos.trailStop : pos.sl;
    let hitSL = false;

    if (pos.side === "long" && currentPrice <= effectiveSL) hitSL = true;
    if (pos.side === "short" && currentPrice >= effectiveSL) hitSL = true;

    if (hitSL) {
      const exitPrice = effectiveSL;
      const pnl = remainingQty * (pos.side === "long" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice);
      const fee = remainingQty * exitPrice * 0.0005;
      const netPnl = pnl - fee;

      this.balance += netPnl;
      this.totalProfit += netPnl;
      this.dailyPnl += netPnl;

      const isWin = netPnl >= 0;
      if (isWin) {
        this.winningTrades++;
        this.consecutiveLosses = 0;
      } else {
        this.losingTrades++;
        this.consecutiveLosses++;
        this.cooldowns[symbol] = Date.now() + profile.cooldownMin * 60000;
      }

      const reason = pos.tp1Hit ? "Trailing Stop (BE)" : "Stop Loss";
      this.log(
        `${isWin ? "✅" : "🔴"} CLOSE ${pos.side.toUpperCase()} ${symbol} | ${reason} | ` +
        `PnL: $${netPnl.toFixed(2)} | Balance: $${this.balance.toFixed(2)} | ` +
        `Streak: ${this.consecutiveLosses > 0 ? `-${this.consecutiveLosses}` : "OK"}`
      );

      // Close on Binance
      try {
        await this.binanceClient.closePosition(
          symbol,
          pos.side === "long" ? "LONG" : "SHORT"
        );
      } catch (_) {}

      pos.status = "closed";
      this.positions[symbol] = null;
      this.symbols[symbol].positions = [];
      return;
    }

    // ---- Check TP1 (partial close) ----
    if (!pos.tp1Hit) {
      let hitTP1 = false;
      if (pos.side === "long" && currentPrice >= pos.tp1) hitTP1 = true;
      if (pos.side === "short" && currentPrice <= pos.tp1) hitTP1 = true;

      if (hitTP1) {
        const closeQty = pos.quantity * pos.tp1ClosePct;
        const profit = closeQty * Math.abs(pos.tp1 - pos.entryPrice);
        const fee = closeQty * pos.tp1 * 0.0005;
        const netProfit = profit - fee;

        this.balance += netProfit;
        this.totalProfit += netProfit;
        this.dailyPnl += netProfit;
        this.consecutiveLosses = 0;

        pos.tp1Hit = true;
        pos.trailStop = pos.entryPrice; // Move SL to break-even
        pos.status = "partial";

        this.log(
          `🎯 TP1 HIT ${symbol} | +$${netProfit.toFixed(2)} | SL → Break-Even | ` +
          `70% still running toward TP2 ($${pos.tp2.toFixed(4)})`
        );
      }
    }

    // ---- Check TP2 (full close) ----
    if (pos.tp1Hit) {
      let hitTP2 = false;
      if (pos.side === "long" && currentPrice >= pos.tp2) hitTP2 = true;
      if (pos.side === "short" && currentPrice <= pos.tp2) hitTP2 = true;

      if (hitTP2) {
        const closeQty = pos.quantity * (1 - pos.tp1ClosePct);
        const profit = closeQty * Math.abs(pos.tp2 - pos.entryPrice);
        const fee = closeQty * pos.tp2 * 0.0005;
        const netProfit = profit - fee;

        this.balance += netProfit;
        this.totalProfit += netProfit;
        this.dailyPnl += netProfit;
        this.winningTrades++;
        this.consecutiveLosses = 0;

        this.log(
          `🏆 TP2 FULL WIN ${symbol} | +$${netProfit.toFixed(2)} | Balance: $${this.balance.toFixed(2)} | ` +
          `PERFECT TRADE!`
        );

        try {
          await this.binanceClient.closePosition(
            symbol,
            pos.side === "long" ? "LONG" : "SHORT"
          );
        } catch (_) {}

        pos.status = "closed";
        this.positions[symbol] = null;
        this.symbols[symbol].positions = [];
        return;
      }

      // ---- Trailing Stop (after TP1) ----
      if (pos.side === "long") {
        const newTrail = currentPrice * (1 - pos.trailPct);
        if (newTrail > pos.trailStop) {
          pos.trailStop = newTrail;
        }
      } else {
        const newTrail = currentPrice * (1 + pos.trailPct);
        if (newTrail < pos.trailStop) {
          pos.trailStop = newTrail;
        }
      }
    }

    // Update symbols for API
    this.symbols[symbol].positions = [pos];
  }

  // ============================================================================
  // STATS & API
  // ============================================================================

  getStats() {
    const winRate =
      this.totalTrades > 0 ? (this.winningTrades / this.totalTrades) * 100 : 0;
    const avgResponseTime =
      this.responseTimes.length > 0
        ? this.responseTimes.reduce((a, b) => a + b, 0) /
          this.responseTimes.length
        : 0;

    return {
      isRunning: this.isRunning,
      balance: this.balance,
      totalProfit: this.totalProfit,
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      losingTrades: this.losingTrades,
      winRate,
      symbols: this.symbols,
      logs: this.logs,
      avgResponseTime,
      lastUpdateTime: this.lastUpdateTime,
      wsConnected: this.binanceFetcher.getConnectionStatus(),
      consecutiveLosses: this.consecutiveLosses,
      dailyPnl: this.dailyPnl,
    };
  }

  getPrice(symbol: string): number {
    // Support both formats: "BTC-USDT" and "BTCUSDT"
    const clean = symbol.replace("-", "");
    return this.symbols[clean]?.price || 0;
  }

  getKlines(symbol: string): any[] {
    const clean = symbol.replace("-", "");
    return this.symbols[clean]?.klines || [];
  }
}
