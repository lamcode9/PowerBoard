import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardStore } from "./boardService";
import { createBackupProject, createCanaryProject, verifyStoredProject } from "./cloudSafety";

describe("cloud safety", () => {
  it("creates a primitive canary and verifies read-back plus exports", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "powerboard-canary-test-"));
    const store = new BoardStore(dir, undefined, "local");
    await store.ensureReady();
    const canary = createCanaryProject("Canary Test", { includePrimitives: true });

    await store.writeBoard(canary);
    const verification = await verifyStoredProject(store, canary, { verifyExports: true });

    expect(canary.metadata.safetyKind).toBe("canary");
    expect(canary.metadata.canaryFixture).toBe("primitive-readback-export");
    expect(canary.elements.some((element) => element.type === "icon" && element.name.includes("Canary"))).toBe(true);
    expect(verification.validation.valid).toBe(true);
    expect(verification.readBack.id).toBe(canary.id);
    expect(verification.exports?.pngPath).toMatch(/\.png$/);
    expect(verification.exports?.reactFiles).toBeGreaterThan(0);
  });

  it("creates a backup candidate with source provenance without changing the source id", () => {
    const source = createCanaryProject("Source Board");
    const backup = createBackupProject(source, "Backup Candidate");

    expect(backup.id).not.toBe(source.id);
    expect(backup.name).toBe("Backup Candidate");
    expect(backup.metadata.safetyKind).toBe("backup");
    expect(backup.metadata.backupOfBoardId).toBe(source.id);
  });
});
