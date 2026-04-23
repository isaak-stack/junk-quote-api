/**
 * test-vision.js — Local smoke test for classifyImagesAI
 *
 * Usage:
 *   1. Drop jpg/jpeg/png files into ./test-images/
 *      (or set IMAGES_DIR env var to a different folder)
 *   2. Make sure ANTHROPIC_API_KEY is set, either:
 *        - in a local Railway Backend/.env file (gitignored), or
 *        - inline: ANTHROPIC_API_KEY=sk-ant-... node test-vision.js
 *   3. Run: node test-vision.js
 *
 * What this does:
 *   - Loads every image file from ./test-images/
 *   - Encodes each to base64
 *   - Calls classifyImagesAI directly (not through the Express API)
 *   - Prints the raw Claude response + validated classification + key fields
 *
 * Firestore quote_audit_log writes are skipped by default in this script —
 * we don't init Firebase here, so the fire-and-forget log is a no-op. That's
 * fine: the point is to verify vision output, not to exercise the logger.
 *
 * NOTE: This script imports classifyImagesAI by side-effecting require of
 * server.js. server.js calls app.listen() at the bottom, so this script will
 * also start the server. To avoid that, we set a flag before require'ing —
 * but server.js doesn't check any flag today, so instead we monkey-patch
 * express's listen to a no-op before require. Ugly but keeps server.js clean.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Prevent server.js's app.listen() from actually binding a port while we
// borrow classifyImagesAI. We need this because server.js calls app.listen()
// at module load time.
const express = require('express');
const originalListen = express.application.listen;
express.application.listen = function () {
  console.log('[test] server.listen() suppressed for test run');
  return { close: () => {} };
};

// Now load server.js — this registers routes and (no longer) binds a port.
// We don't export classifyImagesAI from server.js today, so we require it
// via a small shim: re-require module and pull the symbol off its cache.
require('./server');
const serverMod = require.cache[require.resolve('./server')];
// classifyImagesAI is a top-level function inside server.js, not exported.
// We can reach it via the module's compiled source scope only through
// module.exports; since server.js exports only `app`, we need a different
// approach. Simplest: move classifyImagesAI into module.exports behind an
// internal flag, OR eval. We'll go the "test-only export" route:
const classifyImagesAI = serverMod.exports.__classifyImagesAI;

// Restore listen so production isn't affected by test runs that require this
express.application.listen = originalListen;

if (typeof classifyImagesAI !== 'function') {
  console.error(`
[test] classifyImagesAI is not exported from server.js.
       Add the following line near the bottom of server.js, inside the
       module.exports block (or add one if there isn't one):

         module.exports.__classifyImagesAI = classifyImagesAI;

       (The leading underscore and __ prefix flag it as test-only — not a
       public API. Safe to leave in production; used by test-vision.js only.)
`);
  process.exit(1);
}

const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'test-images');

function mimeFromExt(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function loadImages() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`[test] Directory not found: ${IMAGES_DIR}`);
    console.error('[test] Create it and drop test JPG/PNG files inside, then rerun.');
    process.exit(1);
  }
  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort();
  if (!files.length) {
    console.error(`[test] No image files in ${IMAGES_DIR}`);
    console.error('[test] Drop a few .jpg/.png files in that folder and rerun.');
    process.exit(1);
  }
  return files.map(f => {
    const fullPath = path.join(IMAGES_DIR, f);
    const buf = fs.readFileSync(fullPath);
    return {
      file: f,
      path: fullPath,
      b64: buf.toString('base64'),
      mime: mimeFromExt(f),
      bytes: buf.length
    };
  });
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[test] ANTHROPIC_API_KEY not set. Abort.');
    console.error('[test] Set it in Railway Backend/.env or inline:');
    console.error('[test]   ANTHROPIC_API_KEY=sk-ant-... node test-vision.js');
    process.exit(1);
  }

  const images = loadImages();
  console.log(`\n[test] Loaded ${images.length} image(s) from ${IMAGES_DIR}\n`);

  // Mode 1: run each image individually so we can compare per-image output
  for (const img of images) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[test] Image: ${img.file}  (${(img.bytes / 1024).toFixed(1)} KB, ${img.mime})`);
    const started = Date.now();
    let result;
    try {
      result = await classifyImagesAI([img.b64], img.mime, '');
    } catch (e) {
      console.error(`[test]   classifyImagesAI threw: ${e.message}`);
      continue;
    }
    const elapsed = Date.now() - started;

    console.log(`[test]   Duration:             ${elapsed}ms`);
    console.log(`[test]   Estimated cu. yards:  ${result.estimated_cubic_yards}`);
    console.log(`[test]   Materials:            ${(result.materials || []).join(', ')}`);
    console.log(`[test]   Confidence:           ${result.confidence}`);
    console.log(`[test]   Items spotted:        ${(result.items_spotted || []).join(', ')}`);
    console.log(`[test]   Flags:                longCarry=${result.item_flags?.longCarry} disassembly=${result.item_flags?.disassembly} hoarding=${result.item_flags?.hoarding} elevator=${result.item_flags?.elevator}`);
    console.log(`[test]   Dump counts:          mattresses=${result.dump_items?.mattresses} appliances=${result.dump_items?.appliances} tires=${result.dump_items?.tires} hazmat=${result.dump_items?.hazmat}`);
    console.log(`[test]   Notes:                ${result.notes}`);
    console.log(`[test]   Full JSON:`);
    console.log(JSON.stringify(result, null, 2));
    console.log('');
  }

  // Mode 2: run all images together as a single multi-image request
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[test] Combined run: all ${images.length} images as one call`);
  const startedAll = Date.now();
  let combined;
  try {
    combined = await classifyImagesAI(images.map(i => i.b64), images[0].mime, '');
  } catch (e) {
    console.error(`[test]   Combined call threw: ${e.message}`);
    process.exit(1);
  }
  const elapsedAll = Date.now() - startedAll;
  console.log(`[test]   Duration:             ${elapsedAll}ms`);
  console.log(`[test]   Estimated cu. yards:  ${combined.estimated_cubic_yards}`);
  console.log(`[test]   Materials:            ${(combined.materials || []).join(', ')}`);
  console.log(`[test]   Confidence:           ${combined.confidence}`);
  console.log(`[test]   Items spotted:        ${(combined.items_spotted || []).join(', ')}`);
  console.log(`[test]   Notes:                ${combined.notes}`);
  console.log(`[test]   Full JSON:`);
  console.log(JSON.stringify(combined, null, 2));
  console.log('\n[test] Done. Review the output. If any classification looks off, iterate on the system prompt in server.js.');
})();
