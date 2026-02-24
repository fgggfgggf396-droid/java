
// ============================================================================
// 🧠 SOVEREIGN X — PURE PROBABILISTIC ENGINE v4.0
// Dual-Core (BTC + ETH) | 24/7 Autonomous | Cross Margin | 10x
// Protocol: Probabilistic Entry → 50% Exit @ 1.5x → BE → 3x Full Exit
// ============================================================================

import axios from "axios";
import crypto from "crypto";
import { WebSocket } from "ws";
import pako from "pako";

// ============================================================================
// 📋 TYPES & INTERFACES
// ============================================================================

interface Kline {
  t: number; o: number; h: number; l: number; c: number; v: number;
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
// 🔐 CONFIG — PURE PROBABILISTIC PARAMETERS
// ============================================================================

const CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",

  SYMBOLS: ["BTC-USDT", "ETH-USDT"] as const,

  // === PURE PROBABILISTIC FRAMEWORK ===
  RISK_PERCENT: 0.05,          // 5% of live balance per trade
  RISK_CAP: 50.0,              // Max $50 risk per trade
  FEE_RATE: 0.001,             // 0.1% total fee
  LEVERAGE: 10,                // 10x leverage
  MARGIN_MODE: "CROSSED",      // Cross Margin

  SIGNAL_COOLDOWN_MS: 60000,   // 1 minute cooldown for random signals
  MAX_CONCURRENT: 2,

  MIN_QTY: { "BTC-USDT": 0.001, "ETH-USDT": 0.01 } as Record<string, number>,
};

// ============================================================================
// 🛠️ BingX API Layer
// ============================================================================

function parseParam(paramsMap: Record<string, any>): { paramsStr: string; urlParamsStr: string } {
  const sortedKeys = Object.keys(paramsMap).sort();
  const paramsList: string[] = [];
  const urlParamsList: string[] = [];
  for (const key of sortedKeys) paramsList.push(`${key}=${paramsMap[key]}`);
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
// 🧠 SOVEREIGN X ENGINE CLASS
// ============================================================================

export class TradingEngine {
  private symbols: Map<string, SymbolState> = new Map();
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private pingInterval: any = null;
  private monitorInterval: any = null;
  private signalInterval: any = null;

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

  onEvent(cb: EventCallback) { this.eventCallbacks.push(cb); }
  private emit(event: string, data: any) { for (const cb of this.eventCallbacks) { try { cb(event, data); } catch (e) {} } }
  private log(type: LogEntry["type"], symbol: string, message: string, pnl?: number) {
    const entry: LogEntry = { time: Date.now(), type, symbol, message, pnl };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    console.log(`[ENGINE][${type.toUpperCase()}][${symbol}] ${message}${pnl !== undefined ? ` | PnL: ${pnl.toFixed(4)}` : ""}`);
    this.emit("log", entry);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("info", "SYSTEM", "🚀 Sovereign X — Pure Probabilistic Engine starting...");
    await this.syncBalance();
    this.startBalance = this.balance;
    this.log("info", "SYSTEM", `💰 Balance: $${this.balance.toFixed(2)}`);
    for (const sym of CONFIG.SYMBOLS) await this.setMarginMode(sym, CONFIG.MARGIN_MODE as "CROSSED");
    await this.setLeverageAll(CONFIG.LEVERAGE);
    this.connectWS();
    this.monitorInterval = setInterval(() => this.monitorPositions(), 500);
    this.signalInterval = setInterval(() => this.generateRandomSignals(), 5000);
    this.log("info", "SYSTEM", `✅ Engine running | Pure Probabilistic Mind Active`);
    this.emit("started", this.getStats());
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.log("info", "SYSTEM", "🛑 Engine stopping...");
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.signalInterval) clearInterval(this.signalInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    this.emit("stopped", this.getStats());
  }

  getStats(): EngineStats {
    const symbolStats: Record<string, any> = {};
    for (const [sym, state] of this.symbols) {
      symbolStats[sym] = { price: state.price, klineCount: state.klines.length, hasPosition: state.position !== null, position: state.position };
    }
    return { totalTrades: this.totalTrades, winTrades: this.winTrades, lossTrades: this.lossTrades, totalPnl: this.totalPnl, balance: this.balance, startBalance: this.startBalance, leverage: this.leverage, isRunning: this.isRunning, symbols: symbolStats, logs: this.logs.slice(-100), tpHits: this.tpHits };
  }

  private async syncBalance() {
    try {
      const res = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      if (res.code === 0 && res.data) {
        const data = res.data;
        const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === "USDT") : data;
        if (usdt) this.balance = parseFloat(usdt.availableMargin || usdt.balance || usdt.equity || "0");
      }
    } catch (e: any) { this.log("error", "SYSTEM", `Balance sync failed: ${e.message}`); }
  }

  private async setMarginMode(symbol: string, mode: "CROSSED" | "ISOLATED") {
    try { await bingxRequest("POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType: mode }); } catch (e) {}
  }

  private async setLeverageAll(lev: number) {
    this.leverage = lev;
    for (const sym of CONFIG.SYMBOLS) {
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "LONG", leverage: lev });
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", { symbol: sym, side: "SHORT", leverage: lev });
      } catch (e) {}
    }
  }

  private connectWS() {
    if (this.ws) this.ws.close();
    this.ws = new WebSocket(CONFIG.WS_URL);
    this.ws.on("open", () => {
      this.log("info", "WS", "🔌 Connected to BingX Market Data");
      for (const sym of CONFIG.SYMBOLS) {
        this.ws?.send(JSON.stringify({ id: `sub_${sym}`, reqType: "sub", dataType: `${sym}@lastPrice` }));
      }
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => this.ws?.send("Ping"), 30000);
    });
    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(pako.inflate(data, { to: "string" }));
        if (msg.dataType?.endsWith("@lastPrice")) {
          const sym = msg.dataType.split("@")[0];
          const state = this.symbols.get(sym);
          if (state) {
            state.price = parseFloat(msg.data.lastPrice);
            this.emit("price", { symbol: sym, price: state.price });
          }
        }
      } catch (e) {}
    });
    this.ws.on("close", () => { if (this.isRunning) this.wsReconnectTimer = setTimeout(() => this.connectWS(), 5000); });
  }

  private generateRandomSignals() {
    if (!this.isRunning) return;
    for (const [sym, state] of this.symbols) {
      if (state.position || state.price <= 0) continue;
      if (Date.now() - state.lastSignalTime < state.cooldownMs) continue;

      // Pure Probabilistic Entry (50/50 chance to trigger a trade every check)
      if (Math.random() > 0.5) {
        const side = Math.random() > 0.5 ? "BUY" : "SELL";
        this.openProbabilisticTrade(sym, side);
      }
    }
  }

  private async openProbabilisticTrade(symbol: string, side: "BUY" | "SELL") {
    const state = this.symbols.get(symbol)!;
    state.lastSignalTime = Date.now();
    await this.syncBalance();

    const riskAmount = Math.min(this.balance * CONFIG.RISK_PERCENT, CONFIG.RISK_CAP);
    const entryPrice = state.price;
    
    // Fixed 0.5% SL for the probabilistic model
    const slPercent = 0.005;
    const stopLoss = side === "BUY" ? entryPrice * (1 - slPercent) : entryPrice * (1 + slPercent);
    const riskPerUnit = Math.abs(entryPrice - stopLoss);

    let quantity = (riskAmount * CONFIG.LEVERAGE) / entryPrice;
    quantity = symbol === "BTC-USDT" ? Math.floor(quantity * 1000) / 1000 : Math.floor(quantity * 100) / 100;

    if (quantity < (CONFIG.MIN_QTY[symbol] || 0.001)) return;

    const tp1x5 = side === "BUY" ? entryPrice + riskPerUnit * 1.5 : entryPrice - riskPerUnit * 1.5;
    const tp3x = side === "BUY" ? entryPrice + riskPerUnit * 3 : entryPrice - riskPerUnit * 3;

    this.log("trade", symbol, `🎲 Probabilistic ${side}: qty=${quantity}, entry=$${entryPrice.toFixed(2)}`);

    try {
      const positionSide = side === "BUY" ? "LONG" : "SHORT";
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol, side, positionSide, type: "MARKET", quantity: quantity.toString(),
        stopLoss: JSON.stringify({ type: "STOP_MARKET", stopPrice: parseFloat(stopLoss.toFixed(2)), workingType: "MARK_PRICE" }),
      });

      if (res.code === 0) {
        const filledPrice = parseFloat(res.data?.order?.avgPrice || entryPrice.toString());
        state.position = {
          symbol, side, positionSide, entryPrice: filledPrice, quantity, originalQuantity: quantity,
          stopLoss, takeProfit1x5: tp1x5, takeProfit3x: tp3x, riskAmount, riskPerUnit,
          partialClosed: false, breakEvenMoved: false, openTime: Date.now(),
        };
        this.log("trade", symbol, `✅ FILLED at $${filledPrice.toFixed(2)}`);
        this.emit("trade_opened", { symbol, position: state.position });
      }
    } catch (e: any) { this.log("error", symbol, `❌ Order error: ${e.message}`); }
  }

  private async monitorPositions() {
    if (!this.isRunning) return;
    for (const [sym, state] of this.symbols) {
      if (!state.position || state.price <= 0) continue;
      const pos = state.position;
      const pnlPerUnit = pos.side === "BUY" ? state.price - pos.entryPrice : pos.entryPrice - state.price;
      const riskMultiple = pnlPerUnit / pos.riskPerUnit;

      // SL Hit
      if ((pos.side === "BUY" && state.price <= pos.stopLoss) || (pos.side === "SELL" && state.price >= pos.stopLoss)) {
        await this.closePosition(sym, pos.quantity, pos.breakEvenMoved ? "BREAK_EVEN" : "SL_HIT");
        continue;
      }

      // 1.5x Partial Exit & BE
      if (!pos.partialClosed && riskMultiple >= 1.5) {
        const halfQty = this.roundQty(sym, pos.quantity / 2);
        if (halfQty > 0) {
          this.log("partial", sym, `🎯 1.5x REACHED — Closing 50% + Moving SL to Entry`);
          if (await this.closePartial(sym, halfQty)) {
            pos.partialClosed = true;
            pos.quantity = this.roundQty(sym, pos.quantity - halfQty);
            pos.stopLoss = pos.entryPrice;
            pos.breakEvenMoved = true;
            await this.updateStopLoss(sym, pos);
          }
        }
      }

      // 3x Full Exit
      if (pos.partialClosed && riskMultiple >= 3.0) {
        this.log("close", sym, `🏆 3x FULL TARGET REACHED`);
        await this.closePosition(sym, pos.quantity, "TP_3X");
      }
    }
  }

  private async closePartial(symbol: string, quantity: number): Promise<boolean> {
    const state = this.symbols.get(symbol)!;
    try {
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol, side: state.position!.side === "BUY" ? "SELL" : "BUY",
        positionSide: state.position!.positionSide, type: "MARKET", quantity: quantity.toString(),
      });
      if (res.code === 0) {
        const pnl = (state.position!.side === "BUY" ? state.price - state.position!.entryPrice : state.position!.entryPrice - state.price) * quantity;
        this.totalPnl += pnl; this.balance += pnl;
        this.log("partial", symbol, `✅ Partial close: ${quantity} | PnL: $${pnl.toFixed(4)}`, pnl);
        return true;
      }
    } catch (e) {}
    return false;
  }

  private async closePosition(symbol: string, quantity: number, reason: string) {
    const state = this.symbols.get(symbol)!;
    const pos = state.position!;
    try {
      const res = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol, side: pos.side === "BUY" ? "SELL" : "BUY",
        positionSide: pos.positionSide, type: "MARKET", quantity: quantity.toString(),
      });
      if (res.code === 0) {
        const pnl = (pos.side === "BUY" ? state.price - pos.entryPrice : pos.entryPrice - state.price) * quantity;
        this.totalPnl += pnl; this.balance += pnl; this.totalTrades++;
        if (pnl > 0) this.winTrades++; else this.lossTrades++;
        this.log("close", symbol, `🏁 ${reason}: PnL $${pnl.toFixed(4)}`, pnl);
        state.position = null;
        await this.syncBalance();
      }
    } catch (e) { state.position = null; }
  }

  private async updateStopLoss(symbol: string, pos: ActivePosition) {
    try {
      await bingxRequest("POST", "/openApi/swap/v2/trade/cancelAllOpenOrders", { symbol });
      await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol, side: pos.side === "BUY" ? "SELL" : "BUY", positionSide: pos.positionSide,
        type: "STOP_MARKET", quantity: pos.quantity.toString(),
        stopPrice: parseFloat(pos.stopLoss.toFixed(2)), workingType: "MARK_PRICE",
      });
    } catch (e) {}
  }

  private roundQty(symbol: string, qty: number): number {
    return symbol === "BTC-USDT" ? Math.floor(qty * 1000) / 1000 : Math.floor(qty * 100) / 100;
  }
}
