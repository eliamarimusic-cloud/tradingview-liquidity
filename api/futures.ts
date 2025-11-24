// /api/futures.ts
import type { NextApiRequest, NextApiResponse } from "next";

//
// -------------------- Types --------------------
//
type FuturesSymbol = "ES" | "NQ" | "MNQ" | "CL" | "GC" | "MGC";

interface FuturesQuote {
  symbol: FuturesSymbol;
  price: number | null;
  settlement: number | null;
  open: number | null;
  currHigh: number | null;
  currLow: number | null;

  debug: {
    source: string;
    foundSettlement: boolean;
    settlementSourceText: string;
    errors: string[];
    timestamp: string;
  };

  fallback: {
    used: boolean;
    reason: string;
    value: number | null;
  };
}

//
// -------------------- Yahoo Symbol Map --------------------
//
const SYMBOL_MAP: Record<FuturesSymbol, { yahoo: string }> = {
  ES: { yahoo: "ES=F" },
  NQ: { yahoo: "NQ=F" },
  MNQ: { yahoo: "MNQ=F" },
  CL: { yahoo: "CL=F" },
  GC: { yahoo: "GC=F" },
  MGC: { yahoo: "MGC=F" },
};

//
// -------------------- Yahoo Fetch Logic --------------------
//
async function fetchFromYahoo(symbol: FuturesSymbol): Promise<FuturesQuote> {
  const yahooSymbol = SYMBOL_MAP[symbol].yahoo;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m`;

  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Yahoo returned ${resp.status}`);

    const json = await resp.json();
    const meta = json?.chart?.result?.[0]?.meta;

    if (!meta) throw new Error("Missing Yahoo meta data");

    const price = meta.regularMarketPrice ?? null;
    const settlement = meta.chartPreviousClose ?? null;
    const open = meta.regularMarketOpen ?? settlement ?? null;
    const high = meta.regularMarketDayHigh ?? null;
    const low = meta.regularMarketDayLow ?? null;

    return {
      symbol,
      price,
      settlement,
      open,
      currHigh: high,
      currLow: low,

      debug: {
        source: "YahooFinance",
        foundSettlement: settlement !== null,
        settlementSourceText: "Yahoo chartPreviousClose",
        errors,
        timestamp: nowIso,
      },

      fallback: {
        used: false,
        reason: "",
        value: settlement,
      },
    };
  } catch (err: any) {
    errors.push(err?.message || "Unknown error");

    return {
      symbol,
      price: null,
      settlement: null,
      open: null,
      currHigh: null,
      currLow: null,

      debug: {
        source: "YahooFinance",
        foundSettlement: false,
        settlementSourceText: "",
        errors,
        timestamp: nowIso,
      },

      fallback: {
        used: true,
        reason: "Yahoo request failed",
        value: null,
      },
    };
  }
}

//
// -------------------- API Handler (includes CORS FIX) --------------------
//
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // ---- CORS (fixes your dashboard error) ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  //
  // Main Logic
  //
  const symbols: FuturesSymbol[] = ["ES", "NQ", "MNQ", "CL", "GC", "MGC"];

  const results = await Promise.all(
    symbols.map((sym) => fetchFromYahoo(sym))
  );

  return res.status(200).json({
    timestamp: Date.now(),
    data: results,
  });
}
