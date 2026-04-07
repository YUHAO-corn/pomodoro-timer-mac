#!/usr/bin/env node
// Run once to generate tray-icon.png
// Requires: npm install canvas
// If canvas isn't available, the app uses an empty icon and only shows text

const fs = require('fs');
const path = require('path');

const outPath = path.join(__dirname, 'assets', 'tray-icon.png');

try {
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(32, 32);
  const ctx    = canvas.getContext('2d');

  ctx.clearRect(0, 0, 32, 32);

  // Clock circle
  ctx.strokeStyle = '#2C2822';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, 2 * Math.PI);
  ctx.stroke();

  // Hour hand
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 16);
  ctx.lineTo(16, 9);
  ctx.stroke();

  // Minute hand
  ctx.beginPath();
  ctx.moveTo(16, 16);
  ctx.lineTo(22, 16);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = '#2C2822';
  ctx.beginPath();
  ctx.arc(16, 16, 1.5, 0, 2 * Math.PI);
  ctx.fill();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  console.log('Icon generated:', outPath);
} catch (e) {
  console.log('canvas not available, skipping icon generation. App will use text-only tray.');
}
