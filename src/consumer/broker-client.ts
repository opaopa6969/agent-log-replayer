/**
 * Broker Client
 *
 * Manages subscription to agent-log-broker.
 * Registers as a consumer with full_stream mode
 * and receives BrokerEvent via HTTP callback.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

// Re-export broker types for convenience
// SYNC WITH broker/src/types/broker-event.ts
export interface BrokerEnvelope {
  version: string;
  messageId: string;
  deliveredAt: string;
  deliveryAttempt: number;
}

// SYNC WITH broker/src/types/broker-event.ts
export interface SessionMeta {
  sessionId: string;
  sessionPath: string;
  projectPath: string;
  agentType: string;
}

// SYNC WITH broker/src/types/broker-event.ts
export interface IndexMeta {
  messageIndex: number;
  byteOffset: number;
}

// SYNC WITH broker/src/types/broker-event.ts
export interface AgentMessage {
  role: "user" | "assistant" | "system";
  text?: string;
  toolUses?: unknown[];
  toolResults?: unknown[];
  thinking?: string[];
  timestamp: string;
}

// SYNC WITH broker/src/types/broker-event.ts
export type BrokerEventType =
  | "message"
  | "session.discovered"
  | "session.idle"
  | "session.lost";

// SYNC WITH broker/src/types/broker-event.ts
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

/**
 * Get or create a persistent consumer ID.
 *
 * Priority: explicit arg > file > generate.
 * Persists to `idFilePath` so the same consumerId is reused across restarts,
 * preventing stale consumer accumulation in the broker registry (#10).
 */
export function getOrCreateConsumerId(idFilePath: string): string {
  if (existsSync(idFilePath)) {
    return readFileSync(idFilePath, "utf-8").trim();
  }
  const id = `agent-log-replayer-${randomUUID()}`;
  mkdirSync(dirname(idFilePath), { recursive: true });
  writeFileSync(idFilePath, id, "utf-8");
  return id;
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
      const response = await fetch(`${this.config.brokerUrl}/api/status`, {
        signal: AbortSignal.timeout(3000),
      });
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
