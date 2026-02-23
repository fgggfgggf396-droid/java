import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import crypto from "crypto";
import qs from "qs";
import { WebSocket, WebSocketServer } from "ws";
import pako from "pako";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 🔐 BingX API Configuration
// ============================================================================
const BINGX_CONFIG = {
  API_KEY: "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  REST_URL: "https://open-api.bingx.com",
  WS_URL: "wss://open-api-swap.bingx.com/swap-market",
  SYMBOL: "BTC-USDT",
  LEVERAGE: 10
};

// ============================================================================
// 🛠️ Utility Functions
// ============================================================================

function generateSignature(params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  const queryString = qs.stringify(sortedParams, { encode: false });
  return crypto
    .createHmac("sha256", BINGX_CONFIG.SECRET_KEY)
    .update(queryString)
    .digest("hex");
}

async function bingxRequest(
  method: "GET" | "POST",
  endpoint: string,
  params: Record<string, any> = {}
): Promise<any> {
  try {
    const timestamp = Date.now();
    const requestParams = { ...params, timestamp };
    const signature = generateSignature(requestParams);

    const url = `${BINGX_CONFIG.REST_URL}${endpoint}`;
    const config = {
      method,
      url,
      headers: {
        "X-BX-APIKEY": BINGX_CONFIG.API_KEY,
        "Content-Type": "application/json"
      },
      params: { ...requestParams, signature }
    };

    const response = await axios(config);
    return response.data;
  } catch (error: any) {
    console.error(`❌ BingX API Error [${endpoint}]:`, error.response?.data || error.message);
    throw error;
  }
}

// ============================================================================
// 📡 WebSocket Manager
// ============================================================================

let latestPrice = 0;
let latestKlines: any[] = [];

function initBingXWS(wss: WebSocketServer) {
  const ws = new WebSocket(BINGX_CONFIG.WS_URL);

  ws.on("open", () => {
    console.log("🔌 Connected to BingX WebSocket Market Data");
    
    // Subscribe to Trade (Price)
    const tradeSub = {
      id: "price_sub",
      reqType: "sub",
      dataType: `${BINGX_CONFIG.SYMBOL}@trade`
    };
    ws.send(JSON.stringify(tradeSub));

    // Subscribe to Klines (1m for high precision)
    const klineSub = {
      id: "kline_sub",
      reqType: "sub",
      dataType: `${BINGX_CONFIG.SYMBOL}@kline_1m`
    };
    ws.send(JSON.stringify(klineSub));
  });

  ws.on("message", (data: Buffer) => {
    try {
      // BingX WS data is gzipped
      const decompressed = pako.inflate(data, { to: "string" });
      if (decompressed === "Ping") {
        ws.send("Pong");
        return;
      }

      const json = JSON.parse(decompressed);
      
      if (json.dataType?.endsWith("@trade")) {
        latestPrice = parseFloat(json.data[0]?.p || 0);
        // Broadcast to all connected clients
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "price", data: latestPrice }));
          }
        });
      }

      if (json.dataType?.endsWith("@kline_1m")) {
        const k = json.data[0];
        const kline = {
          t: k.t, o: parseFloat(k.o), h: parseFloat(k.h), 
          l: parseFloat(k.l), c: parseFloat(k.c), v: parseFloat(k.v)
        };
        
        // Update local klines cache
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
    } catch (e) {
      // console.error("WS Message Error:", e);
    }
  });

  ws.on("error", (err) => {
    console.error("WS Error:", err);
    setTimeout(() => initBingXWS(wss), 5000);
  });

  ws.on("close", () => {
    console.log("🔌 WS Connection Closed. Reconnecting...");
    setTimeout(() => initBingXWS(wss), 5000);
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

  // Initialize BingX WS
  initBingXWS(wss);

  app.get("/api/balance", async (req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      let balance = 0;
      if (response.code === 0 && response.data) {
        const data = response.data;
        if (Array.isArray(data)) {
          const usdt = data.find((b: any) => b.asset === "USDT");
          balance = parseFloat(usdt?.balance || 0);
        } else {
          balance = parseFloat(data.availableMargin || data.balance || 0);
        }
      }
      res.json({ success: true, balance });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/price", (req, res) => {
    res.json({ success: true, price: latestPrice });
  });

  app.get("/api/klines", async (req, res) => {
    try {
      if (latestKlines.length > 50) {
        return res.json({ success: true, klines: latestKlines });
      }
      const response = await bingxRequest("GET", "/openApi/swap/v3/quote/klines", {
        symbol: BINGX_CONFIG.SYMBOL,
        interval: "1m",
        limit: 100
      });
      const klines = response.code === 0 ? response.data || [] : [];
      res.json({ success: true, klines });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/trade/buy", async (req, res) => {
    try {
      const { quantity, leverage } = req.body;
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: quantity.toString(),
        leverage: leverage || BINGX_CONFIG.LEVERAGE
      });
      res.json({ success: response.code === 0, orderId: response.data?.orderId, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/trade/sell", async (req, res) => {
    try {
      const { quantity, leverage } = req.body;
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "SELL",
        type: "MARKET",
        quantity: quantity.toString(),
        leverage: leverage || BINGX_CONFIG.LEVERAGE
      });
      res.json({ success: response.code === 0, orderId: response.data?.orderId, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/trade/update-sl", async (req, res) => {
    try {
      const { orderId, stopPrice } = req.body;
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/updateStopLoss", {
        symbol: BINGX_CONFIG.SYMBOL,
        orderId: orderId.toString(),
        stopPrice: stopPrice.toString()
      });
      res.json({ success: response.code === 0, msg: response.msg });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  const staticPath = path.resolve(process.cwd(), "client");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`🚀 Sovereign Master-Brain running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
