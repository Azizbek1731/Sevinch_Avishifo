import { z } from 'zod';

/**
 * A question for AviShifo AI. There is deliberately no clinic parameter: the
 * assistant answers for the caller's own clinic, taken from their session, and
 * nothing the client sends can change that.
 */
export const aiAskSchema = z.object({
  question: z.string().trim().min(3).max(1000),
});
export type AiAskInput = z.infer<typeof aiAskSchema>;

export interface AiAnswer {
  answer: string;
  /** Which data the assistant opened to answer — shown under the reply. */
  usedTools: string[];
}

export interface AiCapabilities {
  enabled: boolean;
  tools: Array<{ name: string; description: string }>;
}
