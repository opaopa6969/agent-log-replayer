import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrokerClient,
  getOrCreateConsumerId,
} from "../src/consumer/broker-client.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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
