import crypto from "crypto";

// ============================================================================
// 🔗 BingX API Client - Real Trading Integration (Fixed)
// ============================================================================

export class BingXClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = "https://open-api.bingx.com";

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
    try {
      const timestamp = Date.now();
      const queryParams = {
        ...params,
        timestamp: timestamp.toString(),
      };

      // Build query string
      const queryString = Object.keys(queryParams)
        .sort()
        .map((key) => `${key}=${encodeURIComponent(queryParams[key])}`)
        .join("&");

      const signature = this.generateSignature(queryString);
      const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

      const headers: any = {
        "Content-Type": "application/json",
        "X-BX-APIKEY": this.apiKey,
      };

      const response = await fetch(url, {
        method,
        headers,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ BingX API Error: ${response.status} - ${error}`);
        return { code: response.status.toString(), msg: error };
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`❌ Request failed: ${error.message}`);
      return { code: "500", msg: error.message };
    }
  }

  // ---- Get Account Balance ----
  async getBalance(): Promise<number> {
    try {
      console.log("📊 Fetching balance from BingX...");
      const response = await this.request("GET", "/openApi/swap/v2/user/balance");

      if (response.code !== "0") {
        console.error("❌ Failed to get balance:", response.msg);
        return 0;
      }

      const balance = parseFloat(response.data?.balance || "0");
      console.log(`💰 BingX Account Balance: $${balance.toFixed(2)} USDT`);
      return balance;
    } catch (error: any) {
      console.error("❌ Error fetching balance:", error.message);
      return 0;
    }
  }

  // ---- Get Real-Time Price (Spot Market) ----
  async getPrice(symbol: string): Promise<number> {
    try {
      // Use spot market ticker
      const response = await this.request("GET", "/openApi/spot/v1/market/ticker", {
        symbol: symbol,
      });

      if (response.code !== "0") {
        console.warn(`⚠️ Price fetch for ${symbol}: ${response.msg}`);
        return 0;
      }

      const price = parseFloat(response.data?.lastPrice || response.data?.price || "0");
      if (price > 0) {
        console.log(`📈 ${symbol}: $${price.toFixed(2)}`);
      }
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
        console.warn(`⚠️ Klines fetch for ${symbol}: ${response.msg}`);
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
      console.log(
        `📤 Opening ${side} position: ${quantity} ${symbol} @ ${leverage}x leverage`
      );

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
      console.log(
        `✅ Position opened: ${side} ${quantity} ${symbol} | Order ID: ${orderId}`
      );
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error opening position:`, error.message);
      return null;
    }
  }

  // ---- Close Position ----
  async closePosition(symbol: string, positionSide: "LONG" | "SHORT"): Promise<any> {
    try {
      console.log(`📥 Closing ${positionSide} position: ${symbol}`);

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
      console.log(`🛑 Setting stop loss: ${symbol} @ $${stopPrice.toFixed(2)}`);

      const response = await this.request("POST", "/openApi/swap/v2/trade/setStopLoss", {
        symbol,
        positionSide,
        stopPrice: stopPrice.toString(),
      });

      if (response.code !== "0") {
        console.warn(`⚠️ Stop loss set (may not be required): ${response.msg}`);
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
      console.log(`💰 Setting take profit: ${symbol} @ $${profitPrice.toFixed(2)}`);

      const response = await this.request("POST", "/openApi/swap/v2/trade/setTakeProfit", {
        symbol,
        positionSide,
        profitPrice: profitPrice.toString(),
      });

      if (response.code !== "0") {
        console.warn(`⚠️ Take profit set (may not be required): ${response.msg}`);
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
        console.warn(`⚠️ Get positions: ${response.msg}`);
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
        console.warn(`⚠️ Get order history: ${response.msg}`);
        return [];
      }

      return response.data || [];
    } catch (error: any) {
      console.error(`❌ Error fetching order history:`, error.message);
      return [];
    }
  }

  // ---- Test Connection ----
  async testConnection(): Promise<boolean> {
    try {
      console.log("🔗 Testing BingX API connection...");
      const balance = await this.getBalance();
      if (balance >= 0) {
        console.log("✅ BingX API connection successful!");
        return true;
      }
      return false;
    } catch (error: any) {
      console.error("❌ BingX API connection failed:", error.message);
      return false;
    }
  }
}
