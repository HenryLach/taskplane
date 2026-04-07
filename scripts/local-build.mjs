#!/usr/bin/env node

/**
 * Local build — copies publishable files from the dev directory to the
 * global npm install location, replacing what `npm publish` + `pi update`
 * would do. Only copies files that are newer or missing at the destination.
 *
 * Usage:
 *   node scripts/local-build.mjs          # incremental (changed files only)
 *   node scripts/local-build.mjs --force  # full copy (all files)
 *   node scripts/local-build.mjs --dry    # preview, no writes
 *
 * Reads `package.json#files` to determine what to copy (same as npm pack).
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");

// Resolve global install target
function resolveGlobalTarget() {
  const npmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
  const target = path.join(npmRoot, "taskplane");
  if (!fs.existsSync(target)) {
    console.error(`❌ Global taskplane not found at ${target}`);
    console.error("   Run: npm install -g taskplane");
    process.exit(1);
  }
  return target;
}

// Read package.json#files to get the publishable file patterns
function getPublishablePatterns() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  return pkg.files || [];
}

// Recursively list all files under a directory
function listFiles(dir, base = "") {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

// Collect all files that match package.json#files patterns
function collectSourceFiles(patterns) {
  const files = new Set();
  // Always include package.json and README.md
  for (const always of ["package.json", "README.md", "LICENSE"]) {
    if (fs.existsSync(path.join(PROJECT_ROOT, always))) {
      files.add(always);
    }
  }
  for (const pattern of patterns) {
    const fullPath = path.join(PROJECT_ROOT, pattern);
    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      for (const file of listFiles(fullPath, pattern)) {
        files.add(file);
      }
    } else {
      files.add(pattern);
    }
  }
  return [...files].sort();
}

// Compare and copy
function syncFiles(sourceFiles, target) {
  let copied = 0;
  let skipped = 0;
  let created = 0;

  for (const relFile of sourceFiles) {
    const src = path.join(PROJECT_ROOT, relFile);
    const dst = path.join(target, relFile);

    if (!fs.existsSync(src)) continue;

    const srcStat = fs.statSync(src);
    const dstExists = fs.existsSync(dst);

    if (!FORCE && dstExists) {
      const dstStat = fs.statSync(dst);
      // Skip if destination is same size and not older
      if (dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    if (DRY) {
      console.log(`  ${dstExists ? "update" : "create"} ${relFile}`);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    if (dstExists) copied++;
    else created++;
  }

  return { copied, skipped, created };
}

// Main
const target = resolveGlobalTarget();
const patterns = getPublishablePatterns();
const sourceFiles = collectSourceFiles(patterns);

console.log(`📦 Local build: ${PROJECT_ROOT}`);
console.log(`   Target: ${target}`);
console.log(`   Files: ${sourceFiles.length} publishable`);
console.log(`   Mode: ${FORCE ? "force" : "incremental"}${DRY ? " (dry run)" : ""}`);
console.log();

const { copied, skipped, created } = syncFiles(sourceFiles, target);

if (DRY) {
  console.log(`\n   Would copy: ${copied} updated + ${created} new (${skipped} unchanged)`);
} else {
  console.log(`   ✅ ${copied} updated, ${created} new, ${skipped} unchanged`);
}
