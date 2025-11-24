// api/futures.ts
// minimal serverless version (no Next.js types)
type FuturesSymbol = 'ES' | 'NQ' | 'MNQ' | 'CL' | 'GC' | 'MGC';

interface FuturesQuote {
  symbol: FuturesSymbol;
  price: number | null;
  settlement: number | null;
  open: number | null;
  currHigh: number | null;
  currLow: number | null;
  debug: any;
  fallback: any;
}

const SYMBOL_MAP: Record<FuturesSymbol, { yahoo: string }> = {
  ES:  { yahoo: 'ES=F' },
  NQ:  { yahoo: 'NQ=F' },
  MNQ: { yahoo: 'MNQ=F' },
  CL:  { yahoo: 'CL=F' },
  GC:  { yahoo: 'GC=F' },
  MGC: { yahoo: 'MGC=F' },
};

async function fetchFromYahoo(symbol: FuturesSymbol): Promise<FuturesQuote> {
  const yahooSymbol = SYMBOL_MAP[symbol].yahoo;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m`;
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Yahoo returned ${resp.status}`);
    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
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
      debug: { source: "YahooFinance", errors, timestamp: nowIso },
      fallback: { used: false, reason: "", value: settlement }
    };

  } catch (err:any) {
    errors.push(err.message || "Unknown error");
    return {
      symbol,
      price: null,
      settlement: null,
      open: null,
      currHigh: null,
      currLow: null,
      debug: { source: "YahooFinance", errors, timestamp: nowIso },
      fallback: { used: true, reason: "Yahoo request failed", value: null }
    };
  }
}

export default async function handler(req:any, res:any) {
  const symbols: FuturesSymbol[] = ['ES','NQ','MNQ','CL','GC','MGC'];
  const results = await Promise.all(symbols.map(sym => fetchFromYahoo(sym)));
  res.status(200).json({ timestamp: Date.now(), data: results });
}
