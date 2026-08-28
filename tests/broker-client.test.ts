import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrokerClient,
  getOrCreateConsumerId,
} from "../src/consumer/broker-client.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("getOrCreateConsumerId", () => {
  it("persists a generated ID and reuses it", () => {
    const directory = mkdtempSync(join(tmpdir(), "replayer-consumer-id-"));
    temporaryDirectories.push(directory);
    const idPath = join(directory, "nested", "consumer-id.txt");

    const firstId = getOrCreateConsumerId(idPath);
    const secondId = getOrCreateConsumerId(idPath);

    expect(firstId).toMatch(/^agent-log-replayer-[0-9a-f-]{36}$/);
    expect(secondId).toBe(firstId);
    expect(readFileSync(idPath, "utf-8")).toBe(firstId);
  });

  it("honors an explicit consumer ID", () => {
    const client = new BrokerClient({
      brokerUrl: "http://localhost:3100",
      callbackUrl: "http://localhost:3200/api/broker/callback",
      consumerId: "configured-consumer",
    });

    expect(client.getConsumerId()).toBe("configured-consumer");
  });
});

describe("BrokerClient.ensureSubscribed", () => {
  function okResponse(): Response {
    return new Response("{}", { status: 200 });
  }

  it("is a no-op when already subscribed and broker reachable", async () => {
    const client = new BrokerClient({
      brokerUrl: "http://broker:3100",
      callbackUrl: "http://localhost:3200/api/broker/callback",
      consumerId: "c1",
    });
    // First subscribe succeeds.
    let subscribeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        if (init?.method === "POST") subscribeCalls++;
        if (url.endsWith("/api/status")) return okResponse();
        if (url.endsWith("/api/subscribe")) return okResponse();
        return new Response("Not Found", { status: 404 });
      }),
    );
    await client.subscribe();
    const result = await client.ensureSubscribed();
    expect(result).toEqual({ subscribed: true, reconnected: false });
    // subscribe() called once on startup, not re-called by ensureSubscribed.
    expect(subscribeCalls).toBe(1);
  });

  it("re-subscribes when subscribed but broker became unreachable", async () => {
    const client = new BrokerClient({
      brokerUrl: "http://broker:3100",
      callbackUrl: "http://localhost:3200/api/broker/callback",
      consumerId: "c2",
    });
    let statusOk = true;
    let subscribeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/api/status")) {
          return statusOk
            ? okResponse()
            : new Response("down", { status: 503 });
        }
        if (url.endsWith("/api/subscribe")) {
          subscribeCalls++;
          return okResponse();
        }
        return new Response("Not Found", { status: 404 });
      }),
    );
    await client.subscribe();
    expect(subscribeCalls).toBe(1);

    // Broker goes down: status 503 → ensureSubscribed should attempt re-subscribe.
    statusOk = false;
    const result = await client.ensureSubscribed();
    expect(result).toEqual({ subscribed: true, reconnected: true });
    expect(subscribeCalls).toBe(2);
  });

  it("reports still-unreachable when re-subscribe also fails", async () => {
    const client = new BrokerClient({
      brokerUrl: "http://broker:3100",
      callbackUrl: "http://localhost:3200/api/broker/callback",
      consumerId: "c3",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/api/status")) {
          return new Response("down", { status: 503 });
        }
        if (url.endsWith("/api/subscribe")) {
          return new Response("forbidden", { status: 403 });
        }
        return new Response("Not Found", { status: 404 });
      }),
    );
    const result = await client.ensureSubscribed();
    expect(result).toEqual({ subscribed: false, reconnected: false });
    expect(client.isSubscribed()).toBe(false);
  });
});
