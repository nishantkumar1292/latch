'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const site = fs.readFileSync(path.resolve(__dirname, '..', '..', 'site', 'index.html'), 'utf8');

test('the landing page does not load executable or font assets from a CDN', () => {
  assert.doesNotMatch(site, /<script[^>]+src=/i);
  assert.doesNotMatch(site, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
  assert.doesNotMatch(site, /fonts\.(googleapis|gstatic)\.com/i);
});
