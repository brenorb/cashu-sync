import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMigrationsStore } from "src/stores/migrations";
import { useUiStore } from "src/stores/ui";

describe("migrations store", () => {
  beforeEach(() => localStorage.clear());

  it("fails closed and releases the mutex when a migration fails", async () => {
    const migrations = useMigrationsStore();
    const ui = useUiStore();
    const failure = new Error("counter migration failed");
    migrations.registerMigration({
      version: 1,
      name: "required counter migration",
      description: "test",
      execute: vi.fn().mockRejectedValue(failure),
    });

    await expect(migrations.runMigrations()).rejects.toBe(failure);
    expect(migrations.currentVersion).toBe(0);
    expect(ui.globalMutexLock).toBe(false);
  });
});
