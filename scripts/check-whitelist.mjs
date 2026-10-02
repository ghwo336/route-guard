#!/usr/bin/env node
// Gate before the experiments (research ch. 4): every mainnet whitelist entry must be
// verified. Unverified entries on other chains (Sepolia) only produce warnings.
//
//   pnpm check:whitelist      exit 0 = OK, 1 = unverified mainnet entries (or unreadable JSON)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chains where an unverified entry blocks the experiments. */
export const STRICT_CHAINS = [1];

/** @param {unknown} wl parsed whitelist JSON */
export function unverifiedEntries(wl) {
  const out = [];
  const visit = (group, entries) => {
    for (const e of Array.isArray(entries) ? entries : []) {
      if (e?.verified !== true)
        out.push({ group, label: e?.label, address: e?.address, source: e?.source });
    }
  };
  for (const [dex, d] of Object.entries(wl?.dexes ?? {})) {
    for (const role of ['routers', 'spenders', 'others', 'feeRecipients'])
      visit(`${dex}.${role}`, d?.[role]);
  }
  visit('utilities', wl?.utilities);
  return out;
}

/**
 * @param {{ file: string, json: any }[]} lists
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkWhitelists(lists) {
  const errors = [];
  const warnings = [];
  for (const { file, json } of lists) {
    const strict = STRICT_CHAINS.includes(json?.chainId);
    for (const e of unverifiedEntries(json)) {
      const line = `${file} (chainId ${json?.chainId}) ${e.group}: ${e.label} ${e.address} — verified:false (source: ${e.source})`;
      (strict ? errors : warnings).push(line);
    }
  }
  return { errors, warnings };
}

function main() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../core/whitelist');
  const lists = [];
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()) {
    try {
      lists.push({ file: f, json: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) });
    } catch (e) {
      console.error(`✗ ${f}: JSON을 읽을 수 없습니다 (${e.message})`);
      process.exit(1);
    }
  }
  const { errors, warnings } = checkWhitelists(lists);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length > 0) {
    console.error(
      `\n메인넷 화이트리스트에 미검증 항목 ${errors.length}개. 실사이트에서 주소를 확인하고 verified:true로 바꾸거나 제거한 뒤 실험을 진행하세요.`,
    );
    process.exit(1);
  }
  console.log(
    `✓ 메인넷 화이트리스트 항목이 모두 검증됨${warnings.length ? ` (경고 ${warnings.length}개)` : ''}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
