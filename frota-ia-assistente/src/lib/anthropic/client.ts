import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5";

export class AnthropicConfigError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY não configurada.");
    this.name = "AnthropicConfigError";
  }
}

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicConfigError();
  return new Anthropic({ apiKey });
}
