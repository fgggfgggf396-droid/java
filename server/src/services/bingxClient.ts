import crypto from "crypto";
import fetch from "node-fetch";

// ============================================================================
// 🔗 BingX API Client - Real Trading Integration
// ============================================================================

export class BingXClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = "https://open-api.bingx.com";
  private wsUrl = "wss://open-api.bingx.com/swap/stream";

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  // ---- Generate HMAC SHA256 signature ----
  private generateSignature(queryString: string): string {
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  // ---- Make signed request ----
  private async request(
    method: string,
    endpoint: string,
    params: any = {}
  ): Promise<any> {
    const timestamp = Date.now();
    const queryString = new URLSearchParams({
      ...params,
      timestamp: timestamp.toString(),
    }).toString();

    const signature = this.generateSignature(queryString);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    const headers: any = {
      "Content-Type": "application/json",
      "X-BX-APIKEY": this.apiKey,
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ BingX API Error: ${response.status} - ${error}`);
        throw new Error(`BingX API Error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`❌ Request failed: ${error.message}`);
      throw error;
    }
  }

  // ---- Get Account Balance ----
  async getBalance(): Promise<number> {
    try {
      const response = await this.request("GET", "/openApi/swap/v2/user/balance");
      
      if (response.code !== "0") {
        console.error("❌ Failed to get balance:", response.msg);
        return 0;
      }

      // BingX returns balance in USDT
      const balance = parseFloat(response.data?.balance || "0");
      console.log(`💰 BingX Account Balance: $${balance.toFixed(2)} USDT`);
      return balance;
    } catch (error: any) {
      console.error("❌ Error fetching balance:", error.message);
      return 0;
    }
  }

  // ---- Get Real-Time Price ----
  async getPrice(symbol: string): Promise<number> {
    try {
      const response = await this.request("GET", "/openApi/spot/v1/market/ticker", {
        symbol: symbol,
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to get price for ${symbol}:`, response.msg);
        return 0;
      }

      const price = parseFloat(response.data?.lastPrice || "0");
      return price;
    } catch (error: any) {
      console.error(`❌ Error fetching price for ${symbol}:`, error.message);
      return 0;
    }
  }

  // ---- Get Klines (Candlestick Data) ----
  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<any[]> {
    try {
      const response = await this.request("GET", "/openApi/spot/v1/market/klines", {
        symbol,
        interval,
        limit,
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to get klines for ${symbol}:`, response.msg);
        return [];
      }

      return response.data || [];
    } catch (error: any) {
      console.error(`❌ Error fetching klines for ${symbol}:`, error.message);
      return [];
    }
  }

  // ---- Open Position (Place Order) ----
  async openPosition(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
    leverage: number = 5
  ): Promise<any> {
    try {
      const response = await this.request("POST", "/openApi/swap/v2/trade/openOrder", {
        symbol,
        side,
        positionSide: side === "BUY" ? "LONG" : "SHORT",
        type: "MARKET",
        quantity: quantity.toString(),
        leverage: leverage.toString(),
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to open position:`, response.msg);
        return null;
      }

      const orderId = response.data?.orderId;
      console.log(`✅ Position opened: ${side} ${quantity} ${symbol} | Order ID: ${orderId}`);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error opening position:`, error.message);
      return null;
    }
  }

  // ---- Close Position ----
  async closePosition(symbol: string, positionSide: "LONG" | "SHORT"): Promise<any> {
    try {
      const response = await this.request("POST", "/openApi/swap/v2/trade/closePosition", {
        symbol,
        positionSide,
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to close position:`, response.msg);
        return null;
      }

      console.log(`✅ Position closed: ${positionSide} ${symbol}`);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error closing position:`, error.message);
      return null;
    }
  }

  // ---- Set Stop Loss ----
  async setStopLoss(
    symbol: string,
    positionSide: "LONG" | "SHORT",
    stopPrice: number
  ): Promise<any> {
    try {
      const response = await this.request("POST", "/openApi/swap/v2/trade/setStopLoss", {
        symbol,
        positionSide,
        stopPrice: stopPrice.toString(),
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to set stop loss:`, response.msg);
        return null;
      }

      console.log(`✅ Stop Loss set: ${symbol} @ $${stopPrice.toFixed(2)}`);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error setting stop loss:`, error.message);
      return null;
    }
  }

  // ---- Set Take Profit ----
  async setTakeProfit(
    symbol: string,
    positionSide: "LONG" | "SHORT",
    profitPrice: number
  ): Promise<any> {
    try {
      const response = await this.request("POST", "/openApi/swap/v2/trade/setTakeProfit", {
        symbol,
        positionSide,
        profitPrice: profitPrice.toString(),
      });

      if (response.code !== "0") {
        console.error(`❌ Failed to set take profit:`, response.msg);
        return null;
      }

      console.log(`✅ Take Profit set: ${symbol} @ $${profitPrice.toFixed(2)}`);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error setting take profit:`, error.message);
      return null;
    }
  }

  // ---- Get Open Positions ----
  async getOpenPositions(): Promise<any[]> {
    try {
      const response = await this.request("GET", "/openApi/swap/v2/user/positions");

      if (response.code !== "0") {
        console.error(`❌ Failed to get positions:`, response.msg);
        return [];
      }

      return response.data || [];
    } catch (error: any) {
      console.error(`❌ Error fetching positions:`, error.message);
      return [];
    }
  }

  // ---- Get Order History ----
  async getOrderHistory(symbol?: string): Promise<any[]> {
    try {
      const params: any = {};
      if (symbol) params.symbol = symbol;

      const response = await this.request("GET", "/openApi/swap/v2/trade/orderHistory", params);

      if (response.code !== "0") {
        console.error(`❌ Failed to get order history:`, response.msg);
        return [];
      }

      return response.data || [];
    } catch (error: any) {
      console.error(`❌ Error fetching order history:`, error.message);
      return [];
    }
  }
}
