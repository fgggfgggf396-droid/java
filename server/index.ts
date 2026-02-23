import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import pako from "pako";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 🔐 BingX API Configuration
// ============================================================================
const BINGX_CONFIG = {
  API_KEY: process.env.BINGX_API_KEY || "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: process.env.BINGX_SECRET_KEY || "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",
  SYMBOL: "BTC-USDT",
  LEVERAGE: 10
};

// ============================================================================
// 🛠️ BingX API Request (matching official Python SDK pattern)
// ============================================================================

function parseParam(paramsMap: Record<string, any>): { paramsStr: string; urlParamsStr: string } {
  const sortedKeys = Object.keys(paramsMap).sort();
  const paramsList: string[] = [];
  const urlParamsList: string[] = [];

  for (const key of sortedKeys) {
    const value = paramsMap[key];
    paramsList.push(`${key}=${value}`);
  }

  const timestamp = Date.now().toString();
  let paramsStr = paramsList.join("&");
  if (paramsStr !== "") {
    paramsStr = paramsStr + "&timestamp=" + timestamp;
  } else {
    paramsStr = "timestamp=" + timestamp;
  }

  // Check if complex values exist (JSON arrays/objects)
  const hasComplex = paramsStr.includes("[") || paramsStr.includes("{");

  for (const key of sortedKeys) {
    const value = paramsMap[key];
    if (hasComplex) {
      urlParamsList.push(`${key}=${encodeURIComponent(String(value))}`);
    } else {
      urlParamsList.push(`${key}=${value}`);
    }
  }

  let urlParamsStr = urlParamsList.join("&");
  if (urlParamsStr !== "") {
    urlParamsStr = urlParamsStr + "&timestamp=" + timestamp;
  } else {
    urlParamsStr = "timestamp=" + timestamp;
  }

  return { paramsStr, urlParamsStr };
}

function getSign(paramsStr: string): string {
  return crypto
    .createHmac("sha256", BINGX_CONFIG.SECRET_KEY)
    .update(paramsStr)
    .digest("hex");
}

async function bingxRequest(
  method: "GET" | "POST",
  endpoint: string,
  params: Record<string, any> = {}
): Promise<any> {
  try {
    const { paramsStr, urlParamsStr } = parseParam(params);
    const signature = getSign(paramsStr);
    const url = `${BINGX_CONFIG.REST_URL}${endpoint}?${urlParamsStr}&signature=${signature}`;

    console.log(`📡 BingX ${method} ${endpoint}`);

    const config: any = {
      method,
      url,
      headers: {
        "X-BX-APIKEY": BINGX_CONFIG.API_KEY,
      }
    };
    // IMPORTANT: Do NOT send data/body for BingX API - all params go in query string
    // Sending data:{} causes axios to add Content-Type: application/json which breaks BingX
    const response = await axios(config);

    const resStr = JSON.stringify(response.data);
    console.log(`✅ [${endpoint}]: ${resStr.substring(0, 300)}`);
    return response.data;
  } catch (error: any) {
    const errData = error.response?.data || error.message;
    console.error(`❌ BingX Error [${endpoint}]:`, errData);
    throw error;
  }
}

// ============================================================================
// 📡 WebSocket Manager
// ============================================================================

let latestPrice = 0;
let latestKlines: any[] = [];
let wsReconnectTimer: any = null;

function initBingXWS(wss: WebSocketServer) {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(BINGX_CONFIG.WS_URL);
  } catch (err) {
    console.error("❌ Failed to create WS:", err);
    wsReconnectTimer = setTimeout(() => initBingXWS(wss), 5000);
    return;
  }

  let pingInterval: any = null;

  ws.on("open", () => {
    console.log("🔌 Connected to BingX WebSocket");

    ws.send(JSON.stringify({
      id: "price_sub",
      reqType: "sub",
      dataType: `${BINGX_CONFIG.SYMBOL}@trade`
    }));

    ws.send(JSON.stringify({
      id: "kline_sub",
      reqType: "sub",
      dataType: `${BINGX_CONFIG.SYMBOL}@kline_1m`
    }));

    // Keep-alive
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("Pong");
      }
    }, 20000);
  });

  ws.on("message", (data: Buffer) => {
    try {
      let decompressed: string;
      try {
        decompressed = pako.inflate(data, { to: "string" });
      } catch {
        decompressed = data.toString();
      }

      if (decompressed === "Ping") {
        ws.send("Pong");
        return;
      }

      const json = JSON.parse(decompressed);

      if (json.dataType?.endsWith("@trade")) {
        const trades = json.data;
        if (Array.isArray(trades) && trades.length > 0) {
          latestPrice = parseFloat(trades[0]?.p || "0");
        } else if (trades?.p) {
          latestPrice = parseFloat(trades.p);
        }
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "price", data: latestPrice }));
          }
        });
      }

      if (json.dataType?.endsWith("@kline_1m")) {
        const kData = json.data;
        const k = Array.isArray(kData) ? kData[0] : kData;
        if (k) {
          const kline = {
            t: k.t || k.T,
            o: parseFloat(k.o || k.O || "0"),
            h: parseFloat(k.h || k.H || "0"),
            l: parseFloat(k.l || k.L || "0"),
            c: parseFloat(k.c || k.C || "0"),
            v: parseFloat(k.v || k.V || "0")
          };

          if (latestKlines.length > 0 && latestKlines[latestKlines.length - 1].t === kline.t) {
            latestKlines[latestKlines.length - 1] = kline;
          } else {
            latestKlines.push(kline);
            if (latestKlines.length > 200) latestKlines.shift();
          }

          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "kline", data: kline }));
            }
          });
        }
      }
    } catch (e) {
      // Silent
    }
  });

  ws.on("error", (err) => {
    console.error("WS Error:", err.message);
    if (pingInterval) clearInterval(pingInterval);
    wsReconnectTimer = setTimeout(() => initBingXWS(wss), 5000);
  });

  ws.on("close", () => {
    console.log("🔌 WS Closed. Reconnecting in 5s...");
    if (pingInterval) clearInterval(pingInterval);
    wsReconnectTimer = setTimeout(() => initBingXWS(wss), 5000);
  });
}

// ============================================================================
// 📊 API Routes & Server
// ============================================================================

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  initBingXWS(wss);

  // ---- Health Check ----
  app.get("/api/health", (_req, res) => {
    res.json({ success: true, status: "running", price: latestPrice, klines: latestKlines.length });
  });

  // ---- Get Balance ----
  app.get("/api/balance", async (_req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      let balance = 0;
      if (response.code === 0 && response.data) {
        const data = response.data;
        if (Array.isArray(data)) {
          const usdt = data.find((b: any) => b.asset === "USDT");
          if (usdt) {
            balance = parseFloat(usdt.balance || usdt.equity || usdt.availableMargin || "0");
          }
        } else {
          balance = parseFloat(data.availableMargin || data.balance || "0");
        }
      }
      res.json({ success: true, balance });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Get Price ----
  app.get("/api/price", (_req, res) => {
    res.json({ success: true, price: latestPrice });
  });

  // ---- Get Klines ----
  app.get("/api/klines", async (_req, res) => {
    try {
      if (latestKlines.length > 50) {
        return res.json({ success: true, klines: latestKlines });
      }
      const response = await bingxRequest("GET", "/openApi/swap/v3/quote/klines", {
        symbol: BINGX_CONFIG.SYMBOL,
        interval: "1m",
        limit: 100
      });
      const klines = response.code === 0 ? (response.data || []) : [];
      res.json({ success: true, klines });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ---- Set Leverage (Hedge Mode: LONG + SHORT) ----
  app.post("/api/trade/leverage", async (req, res) => {
    try {
      const { leverage } = req.body;
      const lev = leverage || BINGX_CONFIG.LEVERAGE;

      // In Hedge mode, must set for both LONG and SHORT
      const longRes = await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "LONG",
        leverage: lev
      });

      const shortRes = await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "SHORT",
        leverage: lev
      });

      const success = longRes.code === 0 && shortRes.code === 0;
      console.log(`⚙️ Leverage set to ${lev}x: ${success ? "SUCCESS" : "PARTIAL"}`);
      res.json({ success, data: longRes.data, msg: success ? "" : (longRes.msg || shortRes.msg) });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Place Buy Order (Hedge Mode: positionSide=LONG) ----
  app.post("/api/trade/buy", async (req, res) => {
    try {
      const { quantity, leverage, stopLoss, takeProfit } = req.body;

      // Set leverage first
      const lev = leverage || BINGX_CONFIG.LEVERAGE;
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
          symbol: BINGX_CONFIG.SYMBOL, side: "LONG", leverage: lev
        });
      } catch (e: any) {
        console.warn("⚠️ Leverage warning:", e.response?.data?.msg || e.message);
      }

      // Build order params
      const orderParams: Record<string, any> = {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "BUY",
        positionSide: "LONG",
        type: "MARKET",
        quantity: quantity.toString()
      };

      // Add SL/TP within the order (stopPrice MUST be number, not string)
      if (stopLoss) {
        orderParams.stopLoss = JSON.stringify({
          type: "STOP_MARKET",
          stopPrice: parseFloat(stopLoss),
          workingType: "MARK_PRICE"
        });
      }
      if (takeProfit) {
        orderParams.takeProfit = JSON.stringify({
          type: "TAKE_PROFIT_MARKET",
          stopPrice: parseFloat(takeProfit),
          workingType: "MARK_PRICE"
        });
      }

      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", orderParams);

      console.log(`🟢 BUY Order: qty=${quantity}, lev=${lev}x, SL=${stopLoss}, TP=${takeProfit}`);
      res.json({
        success: response.code === 0,
        orderId: response.data?.order?.orderId || response.data?.orderId,
        data: response.data,
        msg: response.msg
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Place Sell Order (Hedge Mode: positionSide=SHORT) ----
  app.post("/api/trade/sell", async (req, res) => {
    try {
      const { quantity, leverage, stopLoss, takeProfit } = req.body;

      const lev = leverage || BINGX_CONFIG.LEVERAGE;
      try {
        await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
          symbol: BINGX_CONFIG.SYMBOL, side: "SHORT", leverage: lev
        });
      } catch (e: any) {
        console.warn("⚠️ Leverage warning:", e.response?.data?.msg || e.message);
      }

      const orderParams: Record<string, any> = {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "SELL",
        positionSide: "SHORT",
        type: "MARKET",
        quantity: quantity.toString()
      };

      if (stopLoss) {
        orderParams.stopLoss = JSON.stringify({
          type: "STOP_MARKET",
          stopPrice: parseFloat(stopLoss),
          workingType: "MARK_PRICE"
        });
      }
      if (takeProfit) {
        orderParams.takeProfit = JSON.stringify({
          type: "TAKE_PROFIT_MARKET",
          stopPrice: parseFloat(takeProfit),
          workingType: "MARK_PRICE"
        });
      }

      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", orderParams);

      console.log(`🔴 SELL Order: qty=${quantity}, lev=${lev}x, SL=${stopLoss}, TP=${takeProfit}`);
      res.json({
        success: response.code === 0,
        orderId: response.data?.order?.orderId || response.data?.orderId,
        data: response.data,
        msg: response.msg
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Close Position ----
  app.post("/api/trade/close", async (req, res) => {
    try {
      const { symbol } = req.body;
      const sym = symbol || BINGX_CONFIG.SYMBOL;

      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/closeAllPositions", {
        symbol: sym
      });

      console.log(`🔒 Close positions for ${sym}`);
      res.json({ success: response.code === 0, data: response.data, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Close All Positions ----
  app.post("/api/trade/close-all", async (_req, res) => {
    try {
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/closeAllPositions", {});
      console.log("🔒 Close ALL positions");
      res.json({ success: response.code === 0, data: response.data, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Get Open Positions ----
  app.get("/api/positions", async (_req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v2/user/positions", {
        symbol: BINGX_CONFIG.SYMBOL
      });
      res.json({ success: response.code === 0, data: response.data, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  });

  // ---- Serve Static Files ----
  const staticPath = path.resolve(process.cwd(), "client");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`🚀 Sovereign Master-Brain running on port ${port}`);
    console.log(`📊 Symbol: ${BINGX_CONFIG.SYMBOL} | Leverage: ${BINGX_CONFIG.LEVERAGE}x`);
    console.log(`🔑 API Key: ${BINGX_CONFIG.API_KEY.substring(0, 8)}...`);
  });

  // ---- Set initial leverage on startup (Hedge Mode) ----
  try {
    await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
      symbol: BINGX_CONFIG.SYMBOL, side: "LONG", leverage: BINGX_CONFIG.LEVERAGE
    });
    await bingxRequest("POST", "/openApi/swap/v2/trade/leverage", {
      symbol: BINGX_CONFIG.SYMBOL, side: "SHORT", leverage: BINGX_CONFIG.LEVERAGE
    });
    console.log(`⚙️ Initial leverage set to ${BINGX_CONFIG.LEVERAGE}x (LONG+SHORT)`);
  } catch (err: any) {
    console.warn("⚠️ Could not set initial leverage:", err.response?.data?.msg || err.message);
  }

  // ---- Graceful shutdown ----
  process.on("SIGTERM", () => {
    console.log("🛑 SIGTERM received. Shutting down...");
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("🛑 SIGINT received. Shutting down...");
    server.close(() => process.exit(0));
  });

  // ---- Keep process alive ----
  process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception:", err);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("❌ Unhandled Rejection:", reason);
  });
}

startServer().catch(console.error);
