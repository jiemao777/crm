import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db, type Prisma } from "@crm/db";
import { credentialCipher } from "@crm/db/credentials";
import {
	DEFAULT_AGENT_MODEL,
	readAgentModel,
	SETTINGS_ID,
	writeAgentModel,
} from "@crm/db/settings";
import { activeModel, selectedModel } from "../agent/lib/model";

const providerId = `model-provider-${process.env.TEST_RUN_ID ?? "integration"}`;
const originalEncryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
const testEncryptionKey = Buffer.alloc(32, 7).toString("base64");

async function clear() {
	await db.appSetting.deleteMany({ where: { id: SETTINGS_ID } });
	await db.agentModelProvider.deleteMany({ where: { id: providerId } });
}

/**
 * The row holds the Context key a rep typed and the model they chose, and
 * DATABASE_URL is somebody's working database. Deleting it and not putting it
 * back sends them through the research-key gate again with nothing saying why.
 */
let saved: Prisma.AppSettingUncheckedCreateInput | null = null;

beforeAll(async () => {
	saved = await db.appSetting.findUnique({ where: { id: SETTINGS_ID } });
});

beforeEach(clear);
afterEach(clear);

afterAll(async () => {
	if (saved) await db.appSetting.create({ data: saved });
	if (originalEncryptionKey === undefined) {
		delete process.env.CREDENTIALS_ENCRYPTION_KEY;
	} else {
		process.env.CREDENTIALS_ENCRYPTION_KEY = originalEncryptionKey;
	}
});

describe("the configured model", () => {
	it("falls back when nothing has ever been chosen", async () => {
		const setting = await readAgentModel(db);

		expect(setting.id).toBe(DEFAULT_AGENT_MODEL.id);
		expect(setting.isDefault).toBe(true);

		expect(await selectedModel()).toBeNull();
	});

	it("returns the chosen model with its own context window", async () => {
		await writeAgentModel(db, {
			id: "anthropic/claude-sonnet-5",
			contextWindowTokens: 200_000,
		});

		expect(await selectedModel()).toEqual({
			model: "anthropic/claude-sonnet-5",
			modelContextWindowTokens: 200_000,
		});
	});

	it("resolves the active direct provider before the legacy model", async () => {
		process.env.CREDENTIALS_ENCRYPTION_KEY = testEncryptionKey;
		const cipher = credentialCipher(testEncryptionKey);
		if (!cipher) throw new Error("The test credential cipher is unavailable.");
		await db.agentModelProvider.create({
			data: {
				id: providerId,
				name: "Test provider",
				kind: "custom",
				protocol: "openai-chat",
				baseUrl: "https://provider.example/v1",
				encryptedApiKey: cipher.encrypt("test-key"),
				apiKeyHint: "••••-key",
				modelId: "custom-model",
				contextWindowTokens: 64_000,
				activeSetting: { create: { id: SETTINGS_ID } },
			},
		});

		const model = await activeModel();
		expect(typeof model).not.toBe("string");
		if (typeof model !== "string") {
			expect(model.modelId).toBe("custom-model");
		}
	});

	it("goes back to the fallback when the choice is cleared", async () => {
		await writeAgentModel(db, {
			id: "anthropic/claude-sonnet-5",
			contextWindowTokens: 200_000,
		});
		await writeAgentModel(db, null);

		expect(await selectedModel()).toBeNull();
		expect((await readAgentModel(db)).isDefault).toBe(true);
	});

	it("keeps one row rather than accumulating one per change", async () => {
		await writeAgentModel(db, { id: "openai/gpt-5.5", contextWindowTokens: 1 });
		await writeAgentModel(db, { id: "zai/glm-5.2", contextWindowTokens: 2 });

		expect(await db.appSetting.count()).toBe(1);
		expect((await readAgentModel(db)).id).toBe("zai/glm-5.2");
	});
});
