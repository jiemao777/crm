import { afterEach, describe, expect, it } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../src/config/env.validation";
import type { GoogleSyncService } from "../src/google/google-sync.service";
import {
	LOCAL_SYNC_INTERVAL_MS,
	LocalSyncSchedulerService,
} from "../src/google/local-sync-scheduler.service";

const schedulers: LocalSyncSchedulerService[] = [];

function schedulerFor(
	environment: "development" | "test" | "production",
	runDue: () => Promise<unknown>,
): LocalSyncSchedulerService {
	const sync = { runDue } as GoogleSyncService;
	const config = {
		get: () => environment,
	} as unknown as ConfigService<EnvironmentVariables, true>;
	const scheduler = new LocalSyncSchedulerService(sync, config);
	schedulers.push(scheduler);
	return scheduler;
}

afterEach(async () => {
	await Promise.all(
		schedulers.splice(0).map((scheduler) => scheduler.onApplicationShutdown()),
	);
});

describe("LocalSyncSchedulerService", () => {
	it("runs once at development startup and uses the production cadence", async () => {
		let calls = 0;
		const scheduler = schedulerFor("development", async () => {
			calls += 1;
		});

		scheduler.onApplicationBootstrap();
		await Bun.sleep(0);

		expect(calls).toBe(1);
		expect(LOCAL_SYNC_INTERVAL_MS).toBe(5 * 60_000);
	});

	it.each(["test", "production"] as const)(
		"stays disabled in %s",
		async (environment) => {
			let calls = 0;
			const scheduler = schedulerFor(environment, async () => {
				calls += 1;
			});

			scheduler.onApplicationBootstrap();
			await Bun.sleep(0);

			expect(calls).toBe(0);
		},
	);

	it("waits for an active sync during shutdown", async () => {
		let finish: () => void = () => {};
		const active = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const scheduler = schedulerFor("development", () => active);

		scheduler.onApplicationBootstrap();
		let closed = false;
		const shutdown = scheduler.onApplicationShutdown().then(() => {
			closed = true;
		});
		await Bun.sleep(0);

		expect(closed).toBe(false);
		finish();
		await shutdown;
		expect(closed).toBe(true);
	});
});
