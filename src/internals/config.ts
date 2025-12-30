interface TemporalClientOptions {
  address: string;
  tls?: {
    clientCertPair: {
      crt: Buffer;
      key: Buffer;
    };
  };
}

type ModelProvider = "openai";

export class Config {
  static get MODEL_PROVIDER(): ModelProvider {
    if (!process.env.MODEL_PROVIDER) {
      return "openai";
    }

    return process.env.MODEL_PROVIDER as ModelProvider;
  }

  static get OPENAI_API_KEY(): string {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not defined in environment variables");
    }

    return process.env.OPENAI_API_KEY;
  }

  /**
   * Returns the OpenAI high-tier model name from environment variables or a default value.
   * This model is intended for more complex tasks requiring greater capabilities and reasoning.
   */
  static get OPENAI_HIGH_MODEL(): string {
    if (!process.env.OPENAI_HIGH_MODEL) {
      return "gpt-5.1";
    }

    return process.env.OPENAI_HIGH_MODEL;
  }

  /**
   * Returns the OpenAI low-tier model name from environment variables or a default value.
   * This model is intended for simpler tasks where cost efficiency and speed are prioritized.
   */
  static get OPENAI_LOW_MODEL(): string {
    if (!process.env.OPENAI_LOW_MODEL) {
      return "gpt-5-nano";
    }

    return process.env.OPENAI_LOW_MODEL;
  }

  static get TEMPORAL_NAMESPACE(): string {
    return process.env.TEMPORAL_NAMESPACE || "default";
  }

  static get TEMPORAL_TASK_QUEUE(): string {
    return process.env.TEMPORAL_TASK_QUEUE || "agent-queue";
  }

  static get TEMPORAL_HOST_PORT(): string {
    return process.env.TEMPORAL_HOST_PORT || "localhost:7233";
  }

  static get TMDB_API_KEY(): string {
    if (!process.env.TMDB_API_KEY) {
      throw new Error("TMDB_API_KEY is not defined in environment variables");
    }

    return process.env.TMDB_API_KEY;
  }

  static get BRAVE_SEARCH_API_KEY(): string {
    if (!process.env.BRAVE_SEARCH_API_KEY) {
      throw new Error(
        "BRAVE_SEARCH_API_KEY is not defined in environment variables",
      );
    }

    return process.env.BRAVE_SEARCH_API_KEY;
  }

  static get MAX_CONTEXT_TOKENS(): number {
    const value = process.env.MAX_CONTEXT_TOKENS;
    if (!value) {
      return 12000;
    }
    
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`MAX_CONTEXT_TOKENS must be a valid number, got: ${value}`);
    }
    
    return parsed;
  }

  static get TEMPORAL_CLIENT_OPTIONS(): TemporalClientOptions {
    const temporalClientOptions: TemporalClientOptions = {
      address: Config.TEMPORAL_HOST_PORT,
    };

    return temporalClientOptions;
  }
}
