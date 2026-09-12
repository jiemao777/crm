import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { Glob } from "bun";

type Mode = "all" | "unit" | "integration";

const mode = (process.argv[2] ?? "all") as Mode;
if (!["all", "unit", "integration"].includes(mode)) {
	console.error(`usage: bun scripts/test-runner.ts [all|unit|integration]`);
	process.exit(2);
}

const root = join(import.meta.dir, "..");
const specs = [...new Glob("test/**/*.spec.ts").scanSync({ cwd: root })].sort();

function isIntegration(file: string): boolean {
	if (/\.(integration|e2e)\.spec\.ts$/.test(file)) return true;
	const source = readFileSync(join(root, file), "utf8");
	return source.includes("@crm/db") || source.includes("createTestingModule");
}

const integration = specs.filter(isIntegration);
const unit = specs.filter((file) => !isIntegration(file));

function databaseUrl(): string | undefined {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const envFile = join(import.meta.dir, "..", "..", "..", ".env");
	if (!existsSync(envFile)) return undefined;
	const line = readFileSync(envFile, "utf8")
		.split("\n")
		.find((entry) => entry.startsWith("DATABASE_URL="));
	return line
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
}

function probeDatabase(): Promise<boolean> {
	const url = databaseUrl();
	if (!url) return Promise.resolve(false);
	let host = "localhost";
	let port = 5432;
	try {
		const parsed = new URL(url);
		host = parsed.hostname;
		port = Number(parsed.port) || 5432;
	} catch {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const done = (ok: boolean) => {
			socket.destroy();
			resolve(ok);
		};
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.setTimeout(750, () => done(false));
	});
}

function run(files: string[]): number {
	if (files.length === 0) return 0;
	const result = Bun.spawnSync(["bun", "test", ...files], {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	return result.exitCode ?? 1;
}

const dbUp = await probeDatabase();
const skipIntegration =
	!dbUp && !process.env.CI && integration.length > 0 && mode !== "unit";

if (skipIntegration) {
	console.log(
		`Skipping ${integration.length} integration specs: Postgres is unreachable. ` +
			"Start it with `docker compose up -d`, or run `bun run test:integration` once it is up.",
	);
}

if (mode === "integration" && !dbUp) {
	console.error(
		"Integration specs need Postgres. Start it with `docker compose up -d`.",
	);
	process.exit(1);
}

const files =
	mode === "unit"
		? unit
		: mode === "integration"
			? integration
			: dbUp || process.env.CI
				? specs
				: unit;

process.exit(run(files));
