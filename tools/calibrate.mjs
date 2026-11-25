#!/usr/bin/env node
// Runs the synthetic transform suite and prints the score table that is
// documented in docs/similarity.md.
//
//   node tools/calibrate.mjs            # Markdown table
//   node tools/calibrate.mjs --json     # raw numbers including all components
//   node tools/calibrate.mjs --seeds 5  # more originals per scene type

import { runCalibration, BANDS } from './lib/calibration.mjs';

const args = process.argv.slice(2);
const seedsIndex = args.indexOf('--seeds');
const seedsPerType = seedsIndex >= 0 ? Number(args[seedsIndex + 1]) : 3;
const started = Date.now();
const { originals, rows } = runCalibration({ seedsPerType });

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify({ originals, rows }, null, 2) + '\n');
} else {
  const fmt = (v) => v.toFixed(1);
  const target = (band) => {
    const b = BANDS[band];
    if (b.min !== undefined) return `≥ ${b.min}`;
    if (b.max !== undefined) return `≤ ${b.max}`;
    return '—';
  };
  console.log(`Calibration on ${originals} synthetic originals (${seedsPerType} per scene type), ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  console.log('| Transform | Band | Target | Min | Median | Max |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.label} | ${row.band} | ${target(row.band)} | ${fmt(row.min)} | ${fmt(row.median)} | ${fmt(row.max)} |`);
  }
  const failures = rows.filter((row) => {
    const b = BANDS[row.band];
    return (b.min !== undefined && row.min < b.min) || (b.max !== undefined && row.max > b.max);
  });
  if (failures.length) {
    console.log(`\n${failures.length} band(s) violated: ${failures.map((r) => r.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll bands hold.');
  }
}
