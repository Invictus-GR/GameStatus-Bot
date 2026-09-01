import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyReportChartSvg,
  DAILY_CHART_HEIGHT,
  DAILY_CHART_WIDTH,
  DAILY_REPORT_SIGNATURE,
  renderDailyReportChartPng
} from '../src/dailyReportChart.js';

const start = Date.parse('2026-09-01T00:00:00Z');
const end = Date.parse('2026-09-02T00:00:00Z');

function sample(minutes, players, queue = 0) {
  return {
    sampledAtMs: start + (minutes * 60 * 1000),
    players,
    queue,
    isOnline: true
  };
}

test('builds a signed SVG with both activity plots', () => {
  const svg = buildDailyReportChartSvg({
    reportDate: '2026-09-01',
    windowStartMs: start,
    windowEndMs: end,
    samples: [sample(0, 10), sample(5, 20, 3), sample(10, 30, 5)]
  });

  assert.match(svg, /TLC 24-HOUR SERVER ACTIVITY/);
  assert.match(svg, /PLAYER ACTIVITY/);
  assert.match(svg, /QUEUE ACTIVITY/);
  assert.match(svg, new RegExp(DAILY_REPORT_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(svg, new RegExp(`width="${DAILY_CHART_WIDTH}"`));
  assert.match(svg, new RegExp(`height="${DAILY_CHART_HEIGHT}"`));
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('shows a clear empty state without losing the signature', () => {
  const svg = buildDailyReportChartSvg({
    reportDate: '2026-09-01',
    windowStartMs: start,
    windowEndMs: end,
    samples: []
  });

  assert.match(svg, /No historical samples available/);
  assert.match(svg, /MSgt_Invictus_GR for TLC/);
});

test('splits chart lines across missing sample ranges', () => {
  const svg = buildDailyReportChartSvg({
    reportDate: '2026-09-01',
    windowStartMs: start,
    windowEndMs: end,
    samples: [sample(0, 10), sample(5, 20), sample(60, 40)]
  });
  const playerPaths = svg.match(/stroke="#5c9ded"/g) ?? [];

  assert.equal(playerPaths.length, 2);
});

test('rejects invalid reporting windows', () => {
  assert.throws(
    () => buildDailyReportChartSvg({ windowStartMs: end, windowEndMs: start }),
    /valid reporting window/
  );
});

test('passes the signed SVG through the PNG renderer', async () => {
  let receivedSvg = '';
  const fakeBuffer = Buffer.from('png');
  const sharpFactory = input => {
    receivedSvg = input.toString();
    return {
      png() {
        return {
          async toBuffer() {
            return fakeBuffer;
          }
        };
      }
    };
  };

  const output = await renderDailyReportChartPng({
    reportDate: '2026-09-01',
    windowStartMs: start,
    windowEndMs: end,
    samples: [sample(0, 10)]
  }, { sharpFactory });

  assert.equal(output, fakeBuffer);
  assert.match(receivedSvg, /MSgt_Invictus_GR for TLC/);
});
