const https = require('https');

const calculateRSI = (closes, period = 14) => {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

const fetchTF = (interval) => new Promise((resolve) => {
  https.get(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const klines = JSON.parse(data);
      const closes = klines.map(k => parseFloat(k[4]));
      const rsi = Math.round(calculateRSI(closes, 14));
      const recentCloses = closes.slice(-20);
      const first = recentCloses[0];
      const last = recentCloses[recentCloses.length - 1];
      const trendPct = ((last - first) / first) * 100;
      resolve({ interval, rsi, trendPct: trendPct.toFixed(3) + '%', lastPrice: last });
    });
  }).on('error', console.error);
});

Promise.all(['5m', '15m', '1h', '4h'].map(fetchTF)).then(results => {
  console.log(JSON.stringify(results, null, 2));
});
