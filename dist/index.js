// server/index.ts
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import crypto from "crypto";
import qs from "qs";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var BINGX_CONFIG = {
  API_KEY: "Z4YVpLtqHiDogxdIV5gPD0N1V3dAOuKcW0VD9y76IObcDnqhrRWTstb0oDfMCPmgT7heYk308TPicY7rM0rGw",
  SECRET_KEY: "2Ed3WvfIkFJTEPKQWmL5UvH9AIrHUEOwKIWB4aUNH7KXwuDjhhC1BLyBfipFSWqgog4IGFWyLOVtr9PnCRyYA",
  BASE_URL: "https://open-api.bingx.com",
  SYMBOL: "BTC-USDT",
  LEVERAGE: 10
};
function generateSignature(params) {
  const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {});
  const queryString = qs.stringify(sortedParams, { encode: false });
  return crypto.createHmac("sha256", BINGX_CONFIG.SECRET_KEY).update(queryString).digest("hex");
}
async function bingxRequest(method, endpoint, params = {}) {
  try {
    const timestamp = Date.now();
    const requestParams = { ...params, timestamp };
    const signature = generateSignature(requestParams);
    const url = `${BINGX_CONFIG.BASE_URL}${endpoint}`;
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
  } catch (error) {
    console.error(`BingX API Error [${endpoint}]:`, error.message);
    throw error;
  }
}
async function startServer() {
  const app = express();
  app.use(express.json());
  app.get("/api/balance", async (req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v3/user/balance");
      let balance = 0;
      if (response.code === 0 && response.data) {
        const data = response.data;
        balance = parseFloat(data.availableMargin || data.balance || 0);
      }
      res.json({ success: true, balance });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch balance",
        details: error.message
      });
    }
  });
  app.get("/api/price", async (req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v3/quote/price", {
        symbol: BINGX_CONFIG.SYMBOL
      });
      let price = 0;
      if (response.code === 0 && response.data) {
        price = parseFloat(response.data.price || 0);
      }
      res.json({ success: true, price });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch price",
        details: error.message
      });
    }
  });
  app.post("/api/trade/buy", async (req, res) => {
    try {
      const { quantity, leverage } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid quantity"
        });
      }
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "BUY",
        type: "MARKET",
        quantity: quantity.toString(),
        leverage: leverage || BINGX_CONFIG.LEVERAGE
      });
      const success = response.code === 0;
      res.json({
        success,
        orderId: response.data?.orderId,
        message: response.msg,
        data: response.data
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to open BUY position",
        details: error.message
      });
    }
  });
  app.post("/api/trade/sell", async (req, res) => {
    try {
      const { quantity, leverage } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid quantity"
        });
      }
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: "SELL",
        type: "MARKET",
        quantity: quantity.toString(),
        leverage: leverage || BINGX_CONFIG.LEVERAGE
      });
      const success = response.code === 0;
      res.json({
        success,
        orderId: response.data?.orderId,
        message: response.msg,
        data: response.data
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to open SELL position",
        details: error.message
      });
    }
  });
  app.post("/api/trade/close", async (req, res) => {
    try {
      const { quantity } = req.body;
      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid quantity"
        });
      }
      const positionResponse = await bingxRequest("GET", "/openApi/swap/v2/trade/openOrders", {
        symbol: BINGX_CONFIG.SYMBOL
      });
      let closeSide = "SELL";
      if (positionResponse.code === 0 && positionResponse.data?.length > 0) {
        const position = positionResponse.data[0];
        closeSide = position.side === "BUY" ? "SELL" : "BUY";
      }
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/order", {
        symbol: BINGX_CONFIG.SYMBOL,
        side: closeSide,
        type: "MARKET",
        quantity: quantity.toString()
      });
      const success = response.code === 0;
      res.json({
        success,
        orderId: response.data?.orderId,
        message: response.msg,
        data: response.data
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to close position",
        details: error.message
      });
    }
  });
  app.post("/api/trade/update-sl", async (req, res) => {
    try {
      const { orderId, stopPrice } = req.body;
      if (!orderId || !stopPrice || stopPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid orderId or stopPrice"
        });
      }
      const response = await bingxRequest("POST", "/openApi/swap/v2/trade/updateStopLoss", {
        symbol: BINGX_CONFIG.SYMBOL,
        orderId: orderId.toString(),
        stopPrice: stopPrice.toString()
      });
      const success = response.code === 0;
      res.json({
        success,
        message: response.msg,
        data: response.data
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to update stop loss",
        details: error.message
      });
    }
  });
  app.get("/api/orders", async (req, res) => {
    try {
      const response = await bingxRequest("GET", "/openApi/swap/v2/trade/openOrders", {
        symbol: BINGX_CONFIG.SYMBOL
      });
      const orders = response.code === 0 ? response.data || [] : [];
      res.json({ success: true, orders });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch orders",
        details: error.message
      });
    }
  });
  app.get("/api/klines", async (req, res) => {
    try {
      const { interval = "1h", limit = 100 } = req.query;
      const response = await bingxRequest("GET", "/openApi/swap/v3/quote/klines", {
        symbol: BINGX_CONFIG.SYMBOL,
        interval,
        limit: parseInt(limit)
      });
      const klines = response.code === 0 ? response.data || [] : [];
      res.json({ success: true, klines });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch klines",
        details: error.message
      });
    }
  });
  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
  const port = process.env.PORT || 3e3;
  const server = createServer(app);
  server.listen(port, () => {
    console.log(`\u{1F680} Sovereign Master-Brain running on http://localhost:${port}/`);
    console.log(`\u{1F4E1} Connected to BingX API: ${BINGX_CONFIG.BASE_URL}`);
  });
}
startServer().catch(console.error);
