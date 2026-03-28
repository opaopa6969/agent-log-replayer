/**
 * Broker Client
 *
 * Manages subscription to agent-log-broker.
 * Registers as a consumer with full_stream mode
 * and receives BrokerEvent via HTTP callback.
 */

// Re-export broker types for convenience
export interface BrokerEnvelope {
  version: string;
  messageId: string;
  deliveredAt: string;
  deliveryAttempt: number;
}

export interface SessionMeta {
  sessionId: string;
  sessionPath: string;
  projectPath: string;
  agentType: string;
}

export interface IndexMeta {
  messageIndex: number;
  byteOffset: number;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  text?: string;
  toolUses?: unknown[];
  toolResults?: unknown[];
  thinking?: string[];
  timestamp: string;
}

export type BrokerEventType =
  | "message"
  | "session.discovered"
  | "session.idle"
  | "session.lost";

export interface BrokerEvent {
  _broker: BrokerEnvelope;
  _session: SessionMeta;
  _index?: IndexMeta;
  type: BrokerEventType;
  message?: AgentMessage;
  securityFlags?: unknown[];
  bannedWordHits?: unknown[];
}

export interface BrokerClientConfig {
  brokerUrl: string;
  callbackUrl: string;
  consumerId?: string;
}

export class BrokerClient {
  private config: BrokerClientConfig;
  private consumerId: string;
  private subscribed = false;

  constructor(config: BrokerClientConfig) {
    this.config = config;
    this.consumerId =
      config.consumerId ?? `agent-log-replayer-${Date.now()}`;
  }

  /**
   * Register as a full_stream consumer with the broker.
   */
  async subscribe(): Promise<void> {
    const response = await fetch(`${this.config.brokerUrl}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumerId: this.consumerId,
        callbackUrl: this.config.callbackUrl,
        mode: "full_stream",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Broker subscription failed: ${response.status} ${response.statusText}`
      );
    }

    this.subscribed = true;
  }

  /**
   * Unsubscribe from the broker.
   */
  async unsubscribe(): Promise<void> {
    if (!this.subscribed) return;

    await fetch(
      `${this.config.brokerUrl}/api/subscribe/${this.consumerId}`,
      { method: "DELETE" }
    );

    this.subscribed = false;
  }

  /**
   * Check broker connection status.
   */
  async checkStatus(): Promise<{ connected: boolean; brokerUrl: string }> {
    try {
      const response = await fetch(`${this.config.brokerUrl}/api/status`);
      return {
        connected: response.ok,
        brokerUrl: this.config.brokerUrl,
      };
    } catch {
      return {
        connected: false,
        brokerUrl: this.config.brokerUrl,
      };
    }
  }

  getConsumerId(): string {
    return this.consumerId;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }
}
