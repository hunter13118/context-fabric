/**
 * Cheap token estimator (~4 chars/token heuristic). Good enough for budget
 * accounting and cost telemetry in the prototype; the real system would use
 * a provider tokenizer in the AI Gateway.
 */
export const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));
