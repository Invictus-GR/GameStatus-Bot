export const DAILY_CHART_WIDTH = 1200;
export const DAILY_CHART_HEIGHT = 720;
export const DAILY_SAMPLE_INTERVAL_MINUTES = 5;
export const DAILY_SAMPLE_RETENTION_DAYS = 8;
export const DAILY_REPORT_SIGNATURE =
  'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSample(sample) {
  const sampledAtMs = Number(
    sample?.sampledAtMs ??
    sample?.sampled_at_ms ??
    new Date(sample?.sampled_at ?? Number.NaN).getTime()
  );

  if (!Number.isFinite(sampledAtMs)) return null;

  return {
    sampledAtMs,
    players: clamp(Number(sample?.players) || 0, 0, 128),
    queue: clamp(Number(sample?.queue) || 0, 0, 25),
    isOnline: sample?.isOnline ?? sample?.is_online ?? true
  };
}

function formatLondonTime(timestamp) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
}

function buildLineSegments(samples, key, xScale, yScale) {
  const maximumGapMs = DAILY_SAMPLE_INTERVAL_MINUTES * 2.5 * 60 * 1000;
  const segments = [];
  let current = [];
  let previousTimestamp = null;

  for (const sample of samples) {
    if (
      previousTimestamp !== null &&
      sample.sampledAtMs - previousTimestamp > maximumGapMs
    ) {
      if (current.length > 0) segments.push(current);
      current = [];
    }

    current.push([
      xScale(sample.sampledAtMs),
      yScale(sample[key])
    ]);
    previousTimestamp = sample.sampledAtMs;
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

function pathForSegment(segment) {
  return segment
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
}

function renderPlot({
  samples,
  key,
  maximum,
  label,
  color,
  top,
  height,
  left,
  right,
  windowStartMs,
  windowEndMs,
  showXAxis = false
}) {
  const width = right - left;
  const xScale = timestamp =>
    left + ((timestamp - windowStartMs) / (windowEndMs - windowStartMs)) * width;
  const yScale = value => top + height - (value / maximum) * height;
  const yTicks = [0, Math.round(maximum / 2), maximum];
  const segments = buildLineSegments(samples, key, xScale, yScale);
  const xTicks = Array.from({ length: 7 }, (_, index) => {
    const ratio = index / 6;
    return {
      timestamp: windowStartMs + ((windowEndMs - windowStartMs) * ratio),
      x: left + (width * ratio)
    };
  });

  return `
    <text x="${left}" y="${top - 24}" fill="#f2f3f5" font-size="24" font-weight="700">${escapeXml(label)}</text>
    <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="8" fill="#1e1f22" stroke="#3f4147" stroke-width="2"/>
    ${yTicks.map(value => {
      const y = yScale(value);
      return `
        <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#3f4147" stroke-width="1"/>
        <text x="${left - 16}" y="${y + 6}" fill="#b5bac1" font-size="18" text-anchor="end">${value}</text>`;
    }).join('')}
    ${xTicks.map(tick => `
      <line x1="${tick.x}" y1="${top}" x2="${tick.x}" y2="${top + height}" stroke="#34363c" stroke-width="1"/>
      ${showXAxis ? `<text x="${tick.x}" y="${top + height + 30}" fill="#b5bac1" font-size="17" text-anchor="middle">${formatLondonTime(tick.timestamp)}</text>` : ''}
    `).join('')}
    ${segments.map(segment => `
      <path d="${pathForSegment(segment)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    `).join('')}
  `;
}

export function buildDailyReportChartSvg({
  reportDate = 'Unknown date',
  windowStartMs,
  windowEndMs,
  samples = [],
  signature = DAILY_REPORT_SIGNATURE
}) {
  const start = Number(windowStartMs);
  const end = Number(windowEndMs);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError('Daily chart requires a valid reporting window.');
  }

  const normalizedSamples = samples
    .map(normalizeSample)
    .filter(Boolean)
    .filter(sample => sample.sampledAtMs >= start && sample.sampledAtMs < end)
    .sort((a, b) => a.sampledAtMs - b.sampledAtMs);
  const peakPlayers = normalizedSamples.reduce(
    (peak, sample) => Math.max(peak, sample.players),
    0
  );
  const peakQueue = normalizedSamples.reduce(
    (peak, sample) => Math.max(peak, sample.queue),
    0
  );
  const plotLeft = 92;
  const plotRight = 1150;
  const hasSamples = normalizedSamples.length > 0;

  const playerPlot = renderPlot({
    samples: normalizedSamples,
    key: 'players',
    maximum: 128,
    label: 'PLAYER ACTIVITY',
    color: '#5c9ded',
    top: 172,
    height: 230,
    left: plotLeft,
    right: plotRight,
    windowStartMs: start,
    windowEndMs: end
  });
  const queuePlot = renderPlot({
    samples: normalizedSamples,
    key: 'queue',
    maximum: 25,
    label: 'QUEUE ACTIVITY',
    color: '#f0b232',
    top: 474,
    height: 108,
    left: plotLeft,
    right: plotRight,
    windowStartMs: start,
    windowEndMs: end,
    showXAxis: true
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${DAILY_CHART_WIDTH}" height="${DAILY_CHART_HEIGHT}" viewBox="0 0 ${DAILY_CHART_WIDTH} ${DAILY_CHART_HEIGHT}">
      <rect width="${DAILY_CHART_WIDTH}" height="${DAILY_CHART_HEIGHT}" fill="#2b2d31"/>
      <rect x="32" y="28" width="1136" height="76" rx="12" fill="#1e1f22"/>
      <text x="58" y="63" fill="#f2f3f5" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="700">TLC 24-HOUR SERVER ACTIVITY</text>
      <text x="58" y="89" fill="#b5bac1" font-family="DejaVu Sans, Arial, sans-serif" font-size="18">${escapeXml(reportDate)} • UK time • 5-minute samples</text>
      <text x="1138" y="61" fill="#b5bac1" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" text-anchor="end">PEAK PLAYERS</text>
      <text x="1138" y="88" fill="#f2f3f5" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" font-weight="700" text-anchor="end">${peakPlayers}/128</text>
      <text x="948" y="61" fill="#b5bac1" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" text-anchor="end">PEAK QUEUE</text>
      <text x="948" y="88" fill="#f2f3f5" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" font-weight="700" text-anchor="end">${peakQueue}/25</text>
      <g font-family="DejaVu Sans, Arial, sans-serif">
        ${playerPlot}
        ${queuePlot}
        ${hasSamples ? '' : `
          <rect x="360" y="270" width="480" height="76" rx="10" fill="#313338" stroke="#4e5058"/>
          <text x="600" y="316" fill="#b5bac1" font-size="22" text-anchor="middle">No historical samples available for this date</text>
        `}
      </g>
      <line x1="42" y1="652" x2="1158" y2="652" stroke="#3f4147"/>
      <text x="600" y="687" fill="#949ba4" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" text-anchor="middle">${escapeXml(signature)}</text>
    </svg>`;
}

export async function renderDailyReportChartPng(data, { sharpFactory = null } = {}) {
  const svg = buildDailyReportChartSvg(data);
  let createSharp = sharpFactory;

  if (!createSharp) {
    const sharpModule = await import('sharp');
    createSharp = sharpModule.default;
  }

  return createSharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
}
