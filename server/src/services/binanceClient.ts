import crypto from "crypto";
import fetch from "node-fetch";

// ============================================================================
// 🔗 Binance API Client - Real Trading Integration
// ============================================================================

export class BinanceClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = "https://binance.com";
  private recvWindow = 5000;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private generateSignature(queryString: string): string {
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  private async request(
    method: string,
    endpoint: string,
    params: any = {},
    signed: boolean = true
  ): Promise<any> {
    try {
      const timestamp = Date.now();
      const queryParams = { ...params, timestamp, recvWindow: this.recvWindow };

      let queryString = new URLSearchParams(queryParams).toString();
      let url = `${this.baseUrl}${endpoint}`;

      if (signed) {
        const signature = this.generateSignature(queryString);
        queryString += `&signature=${signature}`;
      }

      url += `?${queryString}`;

      const response = await fetch(url, {
        method,
        headers: {
          "X-MBX-APIKEY": this.apiKey,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Binance API Error: ${JSON.stringify(data)}`);
      }

      return data;
    } catch (error: any) {
      console.error(`Binance Request Error: ${error.message}`);
      throw error;
    }
  }

  // Get account balance
  async getBalance(): Promise<any> {
    try {
      const data = await this.request("GET", "/fapi/v2/account", {}, true);
      const balances: any = {};

      for (const asset of data.assets) {
        if (parseFloat(asset.walletBalance) > 0) {
          balances[asset.asset] = {
            free: parseFloat(asset.availableBalance),
            locked: parseFloat(asset.walletBalance) - parseFloat(asset.availableBalance),
            total: parseFloat(asset.walletBalance),
          };
        }
      }

      return balances;
    } catch (error: any) {
      console.error(`Error getting balance: ${error.message}`);
      return {};
    }
  }

  // Get current price
  async getPrice(symbol: string): Promise<number> {
    try {
      const data = await this.request(
        "GET",
        "/fapi/v1/ticker/price",
        { symbol },
        false
      );
      return parseFloat(data.price);
    } catch (error: any) {
      console.error(`Error getting price for ${symbol}: ${error.message}`);
      return 0;
    }
  }

  // Get klines (candlestick data)
  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<any[]> {
    try {
      const data = await this.request(
        "GET",
        "/fapi/v1/klines",
        { symbol, interval, limit },
        false
      );

      return data.map((kline: any) => ({
        openTime: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: kline[6],
        quoteAssetVolume: parseFloat(kline[7]),
        numberOfTrades: kline[8],
        takerBuyBaseAssetVolume: parseFloat(kline[9]),
        takerBuyQuoteAssetVolume: parseFloat(kline[10]),
      }));
    } catch (error: any) {
      console.error(`Error getting klines for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // Open a futures position
  async openPosition(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
    leverage: number = 5
  ): Promise<any> {
    try {
      // Set leverage first
      await this.request(
        "POST",
        "/fapi/v1/leverage",
        { symbol, leverage: Math.round(leverage) },
        true
      );

      // Open position
      const data = await this.request(
        "POST",
        "/fapi/v1/order",
        {
          symbol,
          side,
          type: "MARKET",
          quantity: quantity.toFixed(4),
          timeInForce: "GTC",
        },
        true
      );

      return {
        orderId: data.orderId,
        symbol: data.symbol,
        side: data.side,
        quantity: parseFloat(data.origQty),
        price: data.avgPrice ? parseFloat(data.avgPrice) : 0,
        status: data.status,
      };
    } catch (error: any) {
      console.error(`Error opening position: ${error.message}`);
      return null;
    }
  }

  // Set stop loss
  async setStopLoss(
    symbol: string,
    side: "LONG" | "SHORT",
    stopPrice: number
  ): Promise<any> {
    try {
      const stopSide = side === "LONG" ? "SELL" : "BUY";
      const data = await this.request(
        "POST",
        "/fapi/v1/order",
        {
          symbol,
          side: stopSide,
          type: "STOP_MARKET",
          stopPrice: stopPrice.toFixed(2),
          closePosition: true,
          timeInForce: "GTC",
        },
        true
      );

      return {
        orderId: data.orderId,
        stopPrice: stopPrice.toFixed(2),
        status: data.status,
      };
    } catch (error: any) {
      console.error(`Error setting stop loss: ${error.message}`);
      return null;
    }
  }

  // Set take profit
  async setTakeProfit(
    symbol: string,
    side: "LONG" | "SHORT",
    takePrice: number,
    quantity?: number
  ): Promise<any> {
    try {
      const tpSide = side === "LONG" ? "SELL" : "BUY";
      const params: any = {
        symbol,
        side: tpSide,
        type: "TAKE_PROFIT_MARKET",
        stopPrice: takePrice.toFixed(2),
        timeInForce: "GTC",
      };

      if (quantity) {
        params.quantity = quantity.toFixed(4);
      } else {
        params.closePosition = true;
      }

      const data = await this.request("POST", "/fapi/v1/order", params, true);

      return {
        orderId: data.orderId,
        takePrice: takePrice.toFixed(2),
        status: data.status,
      };
    } catch (error: any) {
      console.error(`Error setting take profit: ${error.message}`);
      return null;
    }
  }

  // Close position
  async closePosition(symbol: string, side: "LONG" | "SHORT"): Promise<any> {
    try {
      const closeSide = side === "LONG" ? "SELL" : "BUY";
      const data = await this.request(
        "POST",
        "/fapi/v1/order",
        {
          symbol,
          side: closeSide,
          type: "MARKET",
          closePosition: true,
          timeInForce: "GTC",
        },
        true
      );

      return {
        orderId: data.orderId,
        status: data.status,
      };
    } catch (error: any) {
      console.error(`Error closing position: ${error.message}`);
      return null;
    }
  }

  // Get open positions
  async getOpenPositions(): Promise<any[]> {
    try {
      const data = await this.request(
        "GET",
        "/fapi/v2/openOrders",
        {},
        true
      );

      return data.map((order: any) => ({
        symbol: order.symbol,
        orderId: order.orderId,
        side: order.side,
        type: order.type,
        quantity: parseFloat(order.origQty),
        price: parseFloat(order.price),
        status: order.status,
      }));
    } catch (error: any) {
      console.error(`Error getting open positions: ${error.message}`);
      return [];
    }
  }

  // Get account trades
  async getAccountTrades(symbol: string, limit: number = 10): Promise<any[]> {
    try {
      const data = await this.request(
        "GET",
        "/fapi/v1/userTrades",
        { symbol, limit },
        true
      );

      return data.map((trade: any) => ({
        symbol: trade.symbol,
        tradeId: trade.id,
        orderId: trade.orderId,
        side: trade.side,
        price: parseFloat(trade.price),
        quantity: parseFloat(trade.qty),
        commission: parseFloat(trade.commission),
        commissionAsset: trade.commissionAsset,
        time: trade.time,
        realizedProfit: parseFloat(trade.realizedPnl),
      }));
    } catch (error: any) {
      console.error(`Error getting trades: ${error.message}`);
      return [];
    }
  }
}
