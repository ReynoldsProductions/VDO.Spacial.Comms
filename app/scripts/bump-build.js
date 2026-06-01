#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const metaPath = path.join(__dirname, '..', 'build-meta.json');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
meta.build += 1;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
console.log(`Build number bumped → ${meta.version} build ${meta.build}`);
