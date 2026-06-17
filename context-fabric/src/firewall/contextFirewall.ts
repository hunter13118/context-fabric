/**
 * Context Firewall (§12) — treats all retrieved source content as UNTRUSTED
 * DATA, never as instructions. Runs after policy filtering, before ranking
 * and any model call.
 *
 * Responsibilities in the prototype:
 *   - strip/neutralize active content (markdown/HTML, zero-width chars)
 *   - heuristic prompt-injection detection -> risk score
 *   - quarantine high-risk chunks (excluded from model context, flagged)
 *   - attach trust tier (already on the chunk) for downstream weighting
 */
import type { ContextChunk } from "../domain/types.js";

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the) (previous|prior|above) (instructions|prompts)/i,
  /disregard (your|the) (system|previous) (prompt|instructions)/i,
  /\byou are now\b/i,
  /\bact as\b.*\b(admin|root|developer mode)\b/i,
  /reveal (your|the) (system prompt|instructions|api key|secret)/i,
  /\bexfiltrate\b|\bsend (all|the) (data|secrets|tokens)\b/i,
  /override (the )?(policy|permissions|access controls)/i,
  /print (everything|all context|all chunks)/i,
];

const ZERO_WIDTH = /[​-‍﻿⁠]/g;

export interface FirewallResult {
  chunk: ContextChunk;
  /** 0..1 — higher means more likely an injection attempt. */
  riskScore: number;
  quarantined: boolean;
  flags: string[];
}

export function sanitizeChunk(chunk: ContextChunk): FirewallResult {
  const flags: string[] = [];
  let content = chunk.content;

  // 1) Neutralize active content.
  if (ZERO_WIDTH.test(content)) {
    content = content.replace(ZERO_WIDTH, "");
    flags.push("zero_width_removed");
  }
  // Strip markdown/HTML link targets and script-ish constructs.
  const before = content;
  content = content
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\]\((https?:[^)]+)\)/gi, "] ");
  if (content !== before) flags.push("markup_stripped");

  // 2) Injection heuristics.
  let hits = 0;
  for (const re of INJECTION_PATTERNS) if (re.test(content)) hits++;
  const riskScore = Math.min(1, hits / 3);
  if (hits > 0) flags.push(`injection_signals:${hits}`);

  // 3) Quarantine decision. Low-trust + any injection signal => quarantine.
  const lowTrust = chunk.trust_tier === "chat" || chunk.trust_tier === "external_email";
  const quarantined = riskScore >= 0.66 || (lowTrust && hits >= 1 && riskScore >= 0.33);

  return {
    chunk: { ...chunk, content },
    riskScore,
    quarantined,
    flags,
  };
}

export function runFirewall(chunks: ContextChunk[]): FirewallResult[] {
  return chunks.map(sanitizeChunk);
}
