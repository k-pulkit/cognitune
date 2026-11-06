import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentRequest } from "./index.js";

/** Calls the Messages API directly. No tools: the prompt already holds the file text. */
export class SdkAgent implements Agent {
  readonly name = "Anthropic API";
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    timeoutMs: number,
    private readonly planModel = "",
  ) {
    this.client = new Anthropic({ timeout: timeoutMs });
  }

  async complete(req: AgentRequest): Promise<string> {
    const msg = await this.client.messages.create({
      model: req.role === "plan" && this.planModel ? this.planModel : this.model,
      max_tokens: 16_000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
}
