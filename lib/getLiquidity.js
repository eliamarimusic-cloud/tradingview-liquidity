// lib/getLiquidity.js
export default function getLiquidity(symbol) {
  return {
    symbol,
    PDH: 999,
    PDL: 555,
    WeeklyEQ: 777,
    MonthlyEQ: 888,
    stop_run_zones: [{ type: "H", level: 9999 }],
    anchor: "2025-11-24",
    data_unavailable: false,
    data_state: "debug-test"
  };
}
