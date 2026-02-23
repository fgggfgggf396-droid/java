// ============================================================================
// 🧠 INSTITUTIONAL GUARD — The Third Proposal Engine v3.0
// Dual-Core (BTC + ETH) | 24/7 Autonomous | Cross Margin | 10x
// Protocol: SFP Entry → Structural SL → 50% Exit @ 1.5x → BE → 3x Full Exit
// ============================================================================

import axios from "axios";
import crypto from "crypto";
import { WebSocket } from "ws";
import pako from "pako";

// ============================================================================
// 📋 TYPES & INTERFACES
// ============================================================================

interface Kline {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface ActivePosition {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  originalQuantity: number;
  stopLoss: number;
  takeProfit1x5: number;
  takeProfit3x: number;
  riskAmount: number;
  riskPerUnit: number;
  partialClosed: boolean;
  breakEvenMoved: boolean;
  openTime: number;
}

interface SymbolState {
  symbol: string;
  bingxSymbol: string;
  price: number;
  klines: Kline[];
  position: ActivePosition | null;
  lastSignalTime: number;
  cooldownMs: number;
}

interface EngineStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  balance: number;
  startBalance: number;
  leverage: number;
  isRunning: boolean;
  symbols: Record<string, {
    price: number;
    klineCount: number;
    hasPosition: boolean;
    position: ActivePosition | null;
  }>;
  logs: LogEntry[];
  tpHits: number;
}

interface LogEntry {
  time: number;
  type: "info" | "signal" | "trade" | "close" | "error" | "partial";
  symbol: string;
  message: string;
  pnl?: number;
}

type EventCallback = (event: string, data: any) => void;

// ============================================================================
// 🔐 CONFIG — The Third Proposal Parameters (EXACT USER LOGIC)
// ============================================================================

const CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",

  SYMBOLS: ["BTC-USDT", "ETH-USDT"] as const,

  // === USER'S EXACT FINANCIAL FRAMEWORK ===
  RISK_PERCENT: 0.05,          // 5% of live balance per trade
  RISK_CAP: 50.0,              // Max $50 risk per trade (user's riskCap)
  FEE_RATE: 0.0008,            // 0.08% total fee (user's fee)
  LEVERAGE: 10,                // 10x leverage
  MARGIN_MODE: "CROSSED",      // Cross Margin

  // === USER'S EXACT SFP DETECTION ===
  LOOKBACK_CANDLES: 30,        // User's lookback: 30
  SL_BUFFER_PERCENT: 0.0005,   // 0.05% safety buffer behind wick
  SIGNAL_COOLDOWN_MS: 15000,
  MAX_CONCURRENT: 2,           // 1 BTC + 1 ETH max

  MIN_QTY: { "BTC-USDT": 0.001, "ETH-USDT": 0.01 } as Record<string, number>,
};

// ============================================================================
// 🛠️ BingX API Layer
// ============================================================================

function parseParam(paramsMap: Record<string, any>): { paramsStr: string; urlParamsStr: string } {
  const sortedKeys = Object.keys(paramsMap).sort();
  const paramsList: string[] = [];
  const urlParamsList: string[] = [];

  for (const key of sortedKeys) {
    paramsList.push(`${key}=${paramsMap[key]}`);
  }

  const timestamp = Date.now().toString();
  let paramsStr = paramsList.join("&");
  paramsStr = paramsStr !== "" ? paramsStr + "&timestamp=" + timestamp : "timestamp=" + timestamp;

  const hasComplex = paramsStr.includes("[") || paramsStr.includes("{");

  for (const key of sortedKeys) {
    const value = paramsMap[key];
    urlParamsList.push(hasComplex ? `${key}=${encodeURIComponent(String(value))}` : `${key}=${value}`);
  }

  let urlParamsStr = urlParamsList.join("&");
  urlParamsStr = urlParamsStr !== "" ? urlParamsStr + "&timestamp=" + timestamp : "timestamp=" + timestamp;

  return { paramsStr, urlParamsStr };
}

function getSign(paramsStr: string): string {
  return crypto.createHmac("sha256", CONFIG.SECRET_KEY).update(paramsStr).digest("hex");
}

async function bingxRequest(method: "GET" | "POST", endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const { paramsStr, urlParamsStr } = parseParam(params);
  const signature = getSign(paramsStr);
  const url = `${CONFIG.REST_URL}${endpoint}?${urlParamsStr}&signature=${signature}`;

  const response = await axios({ method, url, headers: { "X-BX-APIKEY": CONFIG.API_KEY } });
  return response.data;
}

// ============================================================================
// 🧠 INSTITUTIONAL GUARD ENGINE CLASS
// ============================================================================

export class TradingEngine {
  private symbols: Map<string, SymbolState> = new Map();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private pingInterval: any = null;
  private monitorInterval: any = null;

  private isRunning = false;
  private balance = 0;
  private startBalance = 0;
  private leverage: number = CONFIG.LEVERAGE;
  private totalTrades = 0;
  private winTrades = 0;
  private lossTrades = 0;
  private totalPnl = 0;
  private tpHits = 0;
  private logs: LogEntry[] = [];
  private eventCallbacks: EventCallback[] = [];

  constructor() {
    for (const sym of CONFIG.SYMBOLS) {
      this.symbols.set(sym, {
        symbol: sym,
        bingxSymbol: sym,
        price: 0,
        klines: [],
        position: null,
        lastSignalTime: 0,
        cooldownMs: CONFIG.SIGNAL_COOLDOWN_MS,
      });
    }
  }

  // ---- Event System ----
  onEvent(cb: EventCallback) { this.eventCallbacks.push(cb); }

  private emit(event: string, data: any) {
    for (const cb of this.eventCallbacks) {
      try { cb(event, data); } catch (e) { /* silent */ }
    }
  }

  private log(type: LogEntry["type"], symbol: string, message: string, pnl?: number) {
    const entry: LogEntry = { time: Date.now(), type, symbol, message, pnl };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(`[ENGINE][${type.toUpperCase()}][${symbol}] ${message}${pnl !== undefined ? ` | PnL: ${pnl.toFixed(4)}` : ""}`);
    this.emit("log", entry);
  }

  // ---- Public API ----
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("info", "SYSTEM", "🚀 Institutional Guard v3.0 — The Third Proposal Engine starting...");

    await this.syncBalance();
    this.startBalance = this.balance;
    this.log("info", "SYSTEM", `💰 Balance: $${this.balance.toFixed(2)}`);

    for (const sym of CONFIG.SYMBOLS) {
      await this.setMarginMode(sym, CONFIG.MARGIN_MODE as "CROSSED");
    }

    await this.setLeverageAll(CONFIG.LEVERAGE);

    for (const sym of CONFIG.SYMBOLS) {
      await this.loadKlines(sym);
    }

    this.connectWS();

    // Monitor positions every 500ms — The Third Proposal Protocol
    this.monitorInterval = setInterval(() => this.monitorPositions(), 500);

    this.log("info", "SYSTEM", `✅ Engine running | Symbols: ${CONFIG.SYMBOLS.join(", ")} | Leverage: ${CONFIG.LEVERAGE}x | Risk: ${CONFIG.RISK_PERCENT * 100}% | Cap: $${CONFIG.RISK_CAP} | Margin: CROSS`);
    this.emit("started", this.getStats());
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.log("info", "SYSTEM", "🛑 Engine stopping...");

    if (this.monitorInterval) { clearInterval(this.monitorInterval); this.monitorInterval = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }

    this.emit("stopped", this.getStats());
  }

  getStats(): EngineStats {
    const symbolStats: Record<string, any> = {};
    for (const [sym, state] of this.symbols) {
      symbolStats[sym] = {
        price: state.price,
        klineCount: state.klines.length,
        hasPosition: state.position !== null,
        position: state.position,
      };
    }
    return {
      totalTrades: this.totalTrades,
      winTrades: this.winTrades,
      lossTrades: this.lossTrades,
      totalPnl: this.totalPnl,
      balance: this.balance,
      startBalance: this.startBalance,
      leverage: this.leverage,
      isRunning: this.isRunning,
      symbols: symbolStats,
      logs: this.logs.slice(-100),
      tpHits: this.tpHits,
    };
  }

  getPrice(symbol: string): number {
    return this.symbols.get(symbol)?.price || 0;
  }

  getKlines(symbol: string): Kline[] {
    return this.symbols.get(symbol)?.klines || [];
  }

  // ---- Balance ----
  private async syncBalance() {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      if (res.code === 0 && res.data) {
        const data = res.data;
        if (Array.isArray(data)) {
          const usdt = data.find((b: any) => b.asset === "USDT");
          if (usdt) this.balance = parseFloat(usdt.balance || usdt.equity || usdt.availableMargin || "0");
        } else {
          this.balance = parseFloat(data.availableMargin || data.balance || "0");
        }
      }
    } catch (e: any) {
      this.log("error", "SYSTEM", `Balance sync failed: ${e.message}`);
    }
  }

  // ---- Margin Mode ----
  private async setMarginMode(symbol: string, mode: "CROSSED" | "ISOLATED") {
    try {
      await bingxRequest("POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType: mode });
      this.log("info", symbol, `📐 Margin mode set to ${mode}`);
    } catch (e: any) {
      if (!e.message?.includes("No need")) {
        this.log("info", symbol, `📐 Margin mode already ${mode}`);
      }
    }
  }

  // ---- Leverage ----
  private async setLeverageAll(lev: number) {
    for (const sym of CONFIG.SYMBOLS) {
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "LONG", leverage: lev });
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "SHORT", leverage: lev });
        this.log("info", sym, `⚙️ Leverage set to ${lev}x (LONG+SHORT)`);
      } catch (e: any) {
        this.log("error", sym, `Leverage error: ${e.message}`);
      }
    }
    this.leverage = lev;
  }

  // ---- Load Klines ----
  private async loadKlines(symbol: string) {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/quote/klines", {
        symbol, interval: "1h", limit: 100,
      });
      if (res.code === 0 && res.data) {
        const state = this.symbols.get(symbol);
        if (state) {
          state.klines = res.data.map((k: any) => ({
            t: parseInt(k.time || k[0]),
            o: parseFloat(k.open || k[1]),
            h: parseFloat(k.high || k[2]),
            l: parseFloat(k.low || k[3]),
            c: parseFloat(k.close || k[4]),
            v: parseFloat(k.volume || k[5] || "0"),
          }));
          this.log("info", symbol, `📊 Loaded ${state.klines.length} klines`);
        }
      }
    } catch (e: any) {
      this.log("error", symbol, `Klines error: ${e.message}`);
    }
  }

  // ---- WebSocket ----
  private connectWS() {
    if (this.ws) { try { this.ws.close(); } catch (e) {} }

    const streams = CONFIG.SYMBOLS.map(s => `${s}@kline_1m`).join(",");
    const wsUrl = `${CONFIG.WS_URL}?listenKey=${streams}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      this.log("info", "SYSTEM", "🔌 WebSocket connected — subscribing to dual symbols (Zero Latency)");
      for (const sym of CONFIG.SYMBOLS) {
        const subMsg = JSON.stringify({ id: Date.now().toString(), reqType: "sub", dataType: `${sym}@kline_1m` });
        this.ws?.send(subMsg);
      }

      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send("Ping");
        }
      }, 20000);
    });

    this.ws.on("message", (raw: Buffer) => {
      try {
        let text: string;
        try {
          const decompressed = pako.inflate(raw, { to: "string" });
          text = decompressed;
        } catch {
          text = raw.toString();
        }

        if (text === "Pong" || text === "Ping") return;

        const msg = JSON.parse(text);
        if (msg.dataType && msg.data) {
          const parts = msg.dataType.split("@");
          const symbol = parts[0];
          const klineData = Array.isArray(msg.data) ? msg.data[0] : msg.data;

          if (klineData) {
            const price = parseFloat(klineData.c || klineData.close || "0");
            const state = this.symbols.get(symbol);
            if (state && price > 0) {
              state.price = price;
              this.emit("price", { symbol, price });

              // Update latest kline
              const kline: Kline = {
                t: parseInt(klineData.T || klineData.t || Date.now().toString()),
                o: parseFloat(klineData.o || klineData.open || "0"),
                h: parseFloat(klineData.h || klineData.high || "0"),
                l: parseFloat(klineData.l || klineData.low || "0"),
                c: price,
                v: parseFloat(klineData.v || klineData.volume || "0"),
              };

              if (state.klines.length > 0) {
                const last = state.klines[state.klines.length - 1];
                const klineTime = kline.t;
                const lastTime = last.t;

                if (Math.abs(klineTime - lastTime) < 60000) {
                  state.klines[state.klines.length - 1] = kline;
                } else {
                  state.klines.push(kline);
                  if (state.klines.length > 200) state.klines.shift();
                  // New candle closed — analyze for SFP signal
                  this.analyzeAndTrade(symbol);
                }
              }
            }
          }
        }
      } catch (e) { /* silent parse errors */ }
    });

    this.ws.on("close", () => {
      this.log("info", "SYSTEM", "🔌 WebSocket disconnected — reconnecting in 5s...");
      if (this.isRunning) {
        this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000);
      }
    });

    this.ws.on("error", (err) => {
      this.log("error", "SYSTEM", `WebSocket error: ${err.message}`);
    });
  }

  // ============================================================================
  // 🎯 SFP DETECTION — USER'S EXACT LOGIC
  // detect(h, i) {
  //   const s = h.slice(i - 30, i);
  //   const l = Math.min(...s.map(d=>d.l));
  //   const hi = Math.max(...s.map(d=>d.h));
  //   const c = h[i];
  //   if (c.l < l && c.c > l) return 'BUY';
  //   if (c.h > hi && c.c < hi) return 'SELL';
  //   return null;
  // }
  // ============================================================================

  private detectSFP(klines: Kline[]): { signal: "BUY" | "SELL"; sweepCandle: Kline } | null {
    if (klines.length < CONFIG.LOOKBACK_CANDLES + 1) return null;

    const i = klines.length - 1;
    const current = klines[i];
    const lookbackSlice = klines.slice(i - CONFIG.LOOKBACK_CANDLES, i);

    const lowestLow = Math.min(...lookbackSlice.map(k => k.l));
    const highestHigh = Math.max(...lookbackSlice.map(k => k.h));

    // USER'S EXACT BUY LOGIC: if (c.l < l && c.c > l) return 'BUY';
    if (current.l < lowestLow && current.c > lowestLow) {
      return { signal: "BUY", sweepCandle: current };
    }

    // USER'S EXACT SELL LOGIC: if (c.h > hi && c.c < hi) return 'SELL';
    if (current.h > highestHigh && current.c < highestHigh) {
      return { signal: "SELL", sweepCandle: current };
    }

    return null;
  }

  // ============================================================================
  // 📊 ANALYZE & TRADE — USER'S EXACT FINANCIAL FRAMEWORK
  // riskAmt = Math.min(balance * 0.05, 50)
  // fee = (riskAmt * 10) * 0.0008
  // SL behind sweep candle wick + buffer
  // TP 1.5x = entry ± riskPerUnit * 1.5
  // TP 3x = entry ± riskPerUnit * 3
  // ============================================================================

  private async analyzeAndTrade(symbol: string) {
    const state = this.symbols.get(symbol);
    if (!state || !this.isRunning) return;

    if (Date.now() - state.lastSignalTime < state.cooldownMs) return;
    if (state.position) return;

    let activeCount = 0;
    for (const [, s] of this.symbols) {
      if (s.position) activeCount++;
    }
    if (activeCount >= CONFIG.MAX_CONCURRENT) return;

    const sfp = this.detectSFP(state.klines);
    if (!sfp) return;

    state.lastSignalTime = Date.now();
    this.log("signal", symbol, `🎯 SFP ${sfp.signal} detected at $${state.price.toLocaleString()}`);

    await this.syncBalance();

    // === USER'S EXACT FINANCIAL FRAMEWORK ===
    // riskAmt = Math.min(balance * Logic.risk, Logic.riskCap);
    const riskAmount = Math.min(this.balance * CONFIG.RISK_PERCENT, CONFIG.RISK_CAP);

    const buffer = CONFIG.SL_BUFFER_PERCENT;
    let entryPrice = state.price;
    let stopLoss: number;

    if (sfp.signal === "BUY") {
      stopLoss = sfp.sweepCandle.l * (1 - buffer);
    } else {
      stopLoss = sfp.sweepCandle.h * (1 + buffer);
    }

    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit <= 0) return;

    // Position size: (riskAmount * leverage) / entryPrice
    let quantity = (riskAmount * CONFIG.LEVERAGE) / entryPrice;
    const minQty = CONFIG.MIN_QTY[symbol] || 0.001;

    if (symbol === "BTC-USDT") {
      quantity = Math.floor(quantity * 1000) / 1000;
    } else {
      quantity = Math.floor(quantity * 100) / 100;
    }

    if (quantity < minQty) {
      this.log("info", symbol, `⚠️ Quantity too small: ${quantity} < ${minQty} — skipping`);
      return;
    }

    // TP targets based on risk distance
    const tp1x5 = sfp.signal === "BUY"
      ? entryPrice + riskPerUnit * 1.5
      : entryPrice - riskPerUnit * 1.5;

    const tp3x = sfp.signal === "BUY"
      ? entryPrice + riskPerUnit * 3
      : entryPrice - riskPerUnit * 3;

    this.log("trade", symbol, `📈 Opening ${sfp.signal}: qty=${quantity}, entry=$${entryPrice.toFixed(2)}, SL=$${stopLoss.toFixed(2)}, TP1.5x=$${tp1x5.toFixed(2)}, TP3x=$${tp3x.toFixed(2)} | Risk: $${riskAmount.toFixed(2)}`);

    try {
      const positionSide = sfp.signal === "BUY" ? "LONG" : "SHORT";
      await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
        symbol, side: positionSide, leverage: CONFIG.LEVERAGE,
      });

      const orderParams: Record<string, any> = {
        symbol,
        side: sfp.signal,
        positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
        stopLoss: JSON.stringify({
          type: "STOP_MARKET",
          stopPrice: parseFloat(stopLoss.toFixed(2)),
          workingType: "MARK_PRICE",
        }),
      };

      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", orderParams);

      if (res.code === 0) {
        const filledPrice = parseFloat(res.data?.order?.avgPrice || entryPrice.toString());

        const actualRiskPerUnit = Math.abs(filledPrice - stopLoss);
        const actualTp1x5 = sfp.signal === "BUY"
          ? filledPrice + actualRiskPerUnit * 1.5
          : filledPrice - actualRiskPerUnit * 1.5;
        const actualTp3x = sfp.signal === "BUY"
          ? filledPrice + actualRiskPerUnit * 3
          : filledPrice - actualRiskPerUnit * 3;

        state.position = {
          symbol,
          side: sfp.signal,
          positionSide,
          entryPrice: filledPrice,
          quantity,
          originalQuantity: quantity,
          stopLoss,
          takeProfit1x5: actualTp1x5,
          takeProfit3x: actualTp3x,
          riskAmount,
          riskPerUnit: actualRiskPerUnit,
          partialClosed: false,
          breakEvenMoved: false,
          openTime: Date.now(),
        };

        this.log("trade", symbol, `✅ FILLED at $${filledPrice.toFixed(2)} | SL: $${stopLoss.toFixed(2)} | TP1.5x: $${actualTp1x5.toFixed(2)} | TP3x: $${actualTp3x.toFixed(2)}`);
        this.emit("trade_opened", { symbol, position: state.position });
      } else {
        this.log("error", symbol, `❌ Order failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `❌ Order error: ${e.response?.data?.msg || e.message}`);
    }
  }

  // ============================================================================
  // 🔄 POSITION MONITOR — USER'S EXACT THIRD PROPOSAL PROTOCOL (every 500ms)
  //
  // Phase 1: SL Hit → Full loss = -riskAmt
  // Phase 2: 1.5x reached → Close 50% + Move SL to Entry (Break-Even)
  //          = riskAmt * 0.5 * 1.5 profit locked
  // Phase 3: 3x reached → Close remaining 50%
  //          = riskAmt * 0.5 * 3.0 profit locked
  // Phase BE: If price returns to entry after partial → Exit at zero
  // ============================================================================

  private async monitorPositions() {
    if (!this.isRunning) return;

    for (const [sym, state] of this.symbols) {
      if (!state.position || state.price <= 0) continue;

      const pos = state.position;
      const currentPrice = state.price;

      const pnlPerUnit = pos.side === "BUY"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

      const riskMultiple = pos.riskPerUnit > 0 ? pnlPerUnit / pos.riskPerUnit : 0;

      // ---- PHASE 1: STOP LOSS HIT ----
      const slHit = pos.side === "BUY"
        ? currentPrice <= pos.stopLoss
        : currentPrice >= pos.stopLoss;

      if (slHit) {
        if (pos.breakEvenMoved) {
          this.log("close", sym, `🔒 BREAK-EVEN EXIT at $${currentPrice.toFixed(2)} — Capital protected`);
          await this.closePosition(sym, pos.quantity, "BREAK_EVEN");
        } else {
          this.log("close", sym, `🛑 STOP LOSS HIT at $${currentPrice.toFixed(2)}`);
          await this.closePosition(sym, pos.quantity, "SL_HIT");
        }
        continue;
      }

      // ---- PHASE 2: 1.5x REACHED → Close 50% + Move SL to Entry ----
      if (!pos.partialClosed && riskMultiple >= 1.5) {
        const halfQty = this.roundQty(sym, pos.quantity / 2);
        if (halfQty > 0) {
          this.log("partial", sym, `🎯 1.5x REACHED ($${currentPrice.toFixed(2)}) — Closing 50% (${halfQty}) + Moving SL to Entry`);
          const success = await this.closePartial(sym, halfQty);
          if (success) {
            pos.partialClosed = true;
            pos.quantity = this.roundQty(sym, pos.quantity - halfQty);
            this.tpHits++;

            // Move SL to break-even (entry price) — USER'S EXACT LOGIC
            pos.stopLoss = pos.entryPrice;
            pos.breakEvenMoved = true;
            this.log("info", sym, `🔒 SL moved to Break-Even: $${pos.entryPrice.toFixed(2)} — Remaining: ${pos.quantity}`);

            await this.updateStopLoss(sym, pos);
            this.emit("partial_close", { symbol: sym, position: pos });
          }
        }
      }

      // ---- PHASE 3: 3x REACHED → Close remaining 50% ----
      if (pos.partialClosed && riskMultiple >= 3.0) {
        this.log("close", sym, `🏆 3x FULL TARGET ($${currentPrice.toFixed(2)}) — Closing remaining ${pos.quantity}`);
        this.tpHits++;
        await this.closePosition(sym, pos.quantity, "TP_3X");
      }
    }
  }

  // ---- Close partial position ----
  private async closePartial(symbol: string, quantity: number): Promise<boolean> {
    const state = this.symbols.get(symbol);
    if (!state?.position) return false;

    try {
      const closeSide = state.position.side === "BUY" ? "SELL" : "BUY";
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: state.position.positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
      });

      if (res.code === 0) {
        const partialPnl = (state.position.side === "BUY"
          ? state.price - state.position.entryPrice
          : state.position.entryPrice - state.price) * quantity;

        this.totalPnl += partialPnl;
        this.balance += partialPnl;
        this.log("partial", symbol, `✅ Partial close: ${quantity} units | PnL: $${partialPnl.toFixed(4)}`, partialPnl);
        return true;
      }
      return false;
    } catch (e: any) {
      this.log("error", symbol, `Partial close error: ${e.message}`);
      return false;
    }
  }

  // ---- Close full position ----
  private async closePosition(symbol: string, quantity: number, reason: string) {
    const state = this.symbols.get(symbol);
    if (!state?.position) return;

    const pos = state.position;
    try {
      const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: pos.positionSide,
        type: "MARKET",
        quantity: quantity.toString(),
      });

      if (res.code === 0) {
        const pnlPerUnit = pos.side === "BUY"
          ? state.price - pos.entryPrice
          : pos.entryPrice - state.price;
        const tradePnl = pnlPerUnit * quantity;

        this.totalPnl += tradePnl;
        this.balance += tradePnl;
        this.totalTrades++;

        const isWin = reason === "TP_3X" || reason === "BREAK_EVEN" || tradePnl > 0;
        if (isWin) this.winTrades++; else this.lossTrades++;

        const emoji = reason === "TP_3X" ? "🏆" : reason === "BREAK_EVEN" ? "🔒" : tradePnl > 0 ? "🟢" : "🔴";
        this.log("close", symbol, `${emoji} ${reason}: PnL $${tradePnl.toFixed(4)} | Balance: $${this.balance.toFixed(2)} | Total PnL: $${this.totalPnl.toFixed(4)}`, tradePnl);

        state.position = null;
        this.emit("trade_closed", { symbol, pnl: tradePnl, reason, isWin });

        await this.syncBalance();
      } else {
        this.log("error", symbol, `Close failed: ${res.msg}`);
      }
    } catch (e: any) {
      this.log("error", symbol, `Close error: ${e.message}`);
      state.position = null;
    }
  }

  // ---- Update SL on exchange ----
  private async updateStopLoss(symbol: string, pos: ActivePosition) {
    try {
      await bingxRequest("POST", "/openApi/swap/v2/trade/cancelAllOpenOrders", { symbol });

      const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
      await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol,
        side: closeSide,
        positionSide: pos.positionSide,
        type: "STOP_MARKET",
        quantity: pos.quantity.toString(),
        stopPrice: parseFloat(pos.stopLoss.toFixed(2)),
        workingType: "MARK_PRICE",
      });

      this.log("info", symbol, `📝 SL updated on exchange to $${pos.stopLoss.toFixed(2)}`);
    } catch (e: any) {
      this.log("error", symbol, `SL update error: ${e.message} — programmatic SL still active`);
    }
  }

  // ---- Utility ----
  private roundQty(symbol: string, qty: number): number {
    if (symbol === "BTC-USDT") return Math.floor(qty * 1000) / 1000;
    return Math.floor(qty * 100) / 100;
  }
}
