import { z } from "zod";
import type { KeyCheck, LookupResult, SearchResult } from "./research-types";

const TAVILY_API_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 60_000;

const resultSchema = z.object({
	title: z.string().nullable().optional(),
	url: z.string().nullable().optional(),
	content: z.string().nullable().optional(),
	raw_content: z.string().nullable().optional(),
	favicon: z.string().nullable().optional(),
});

const searchResponseSchema = z.object({
	results: z.array(resultSchema).default([]),
});

const extractResponseSchema = z.object({
	results: z.array(resultSchema).default([]),
	failed_results: z.array(z.unknown()).default([]),
});

export type TavilySearchOptions = {
	limit?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	depth?: "basic" | "advanced";
	includeFavicon?: boolean;
};

export async function verifyTavilyKey(
	apiKey: string | null,
): Promise<KeyCheck> {
	if (!apiKey) return { outcome: "valid" };

	try {
		await tavilyRequest("/usage", apiKey, { method: "GET" });
		return { outcome: "valid" };
	} catch (error) {
		if (error instanceof TavilyApiError && error.status === 401) {
			return {
				outcome: "invalid",
				reason: "Tavily did not recognise that API key.",
			};
		}
		return { outcome: "unknown", reason: describe(error) };
	}
}

export async function tavilyBrandByDomain(
	apiKey: string | null,
	domain: string,
): Promise<LookupResult> {
	try {
		const response = await tavilySearch(apiKey, `${domain} official company`, {
			limit: 5,
			includeDomains: [domain],
			depth: "basic",
			includeFavicon: true,
		});
		const result = preferredResult(response.results, domain);
		if (!result) {
			return { outcome: "skipped", reason: "No company website matched." };
		}

		return {
			outcome: "found",
			source: "tavily",
			brand: {
				domain,
				title: cleanTitle(result.title, domain),
				description: clean(result.content),
				logos: result.favicon ? [{ url: result.favicon, type: "icon" }] : [],
			},
			raw: response,
		};
	} catch (error) {
		return {
			outcome: "failed",
			reason: describe(error),
			retryable: retryable(error),
		};
	}
}

export async function tavilySearchWeb(
	apiKey: string | null,
	query: string,
	options: TavilySearchOptions = {},
): Promise<
	| { outcome: "found"; results: SearchResult[] }
	| { outcome: "failed"; reason: string }
> {
	try {
		const response = await tavilySearch(apiKey, query, options);
		return {
			outcome: "found",
			results: response.results.map((result) => ({
				url: result.url ?? null,
				title: result.title ?? null,
				description: result.content ?? null,
				markdown: result.raw_content ?? result.content ?? null,
			})),
		};
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

export async function tavilySiteSources(
	apiKey: string | null,
	url: string,
	instructions: string,
): Promise<
	| { outcome: "found"; sources: SearchResult[] }
	| { outcome: "failed"; reason: string }
> {
	let domain: string;
	try {
		domain = new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return { outcome: "failed", reason: "The company website URL is invalid." };
	}

	const query = `${instructions.slice(0, 320)} Official website: ${domain}`;
	const searched = await tavilySearchWeb(apiKey, query, {
		limit: 8,
		includeDomains: [domain],
		depth: "advanced",
	});
	if (searched.outcome === "found" && searched.results.length > 0) {
		return { outcome: "found", sources: searched.results };
	}

	try {
		const response = extractResponseSchema.parse(
			await tavilyRequest("/extract", apiKey, {
				method: "POST",
				body: JSON.stringify({
					urls: [url],
					extract_depth: "advanced",
					format: "markdown",
					include_images: false,
					include_favicon: false,
				}),
			}),
		);
		const sources = response.results.map((result) => ({
			url: result.url ?? url,
			title: result.title ?? null,
			description: null,
			markdown: result.raw_content ?? result.content ?? null,
		}));
		return sources.length > 0
			? { outcome: "found", sources }
			: {
					outcome: "failed",
					reason:
						searched.outcome === "failed"
							? searched.reason
							: "Tavily returned no content for that website.",
				};
	} catch (error) {
		return {
			outcome: "failed",
			reason: searched.outcome === "failed" ? searched.reason : describe(error),
		};
	}
}

async function tavilySearch(
	apiKey: string | null,
	query: string,
	options: TavilySearchOptions,
) {
	return searchResponseSchema.parse(
		await tavilyRequest("/search", apiKey, {
			method: "POST",
			body: JSON.stringify({
				query,
				search_depth: options.depth ?? "basic",
				chunks_per_source: 3,
				max_results: Math.min(Math.max(options.limit ?? 10, 1), 20),
				topic: "general",
				include_answer: false,
				include_raw_content: false,
				include_images: false,
				include_favicon: options.includeFavicon ?? false,
				include_domains: options.includeDomains ?? [],
				exclude_domains: options.excludeDomains ?? [],
				auto_parameters: false,
				safe_search: true,
			}),
		}),
	);
}

async function tavilyRequest(
	path: string,
	apiKey: string | null,
	init: RequestInit,
): Promise<unknown> {
	const response = await fetch(`${TAVILY_API_URL}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			...(apiKey
				? { authorization: `Bearer ${apiKey}` }
				: { "x-tavily-access-mode": "keyless" }),
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) throw new TavilyApiError(response.status);
	return body;
}

class TavilyApiError extends Error {
	constructor(readonly status: number) {
		super(`Tavily request failed with status ${status}.`);
	}
}

function preferredResult(
	results: z.infer<typeof resultSchema>[],
	domain: string,
) {
	return results
		.filter((result) => hostOf(result.url) === domain.replace(/^www\./, ""))
		.sort((left, right) => pathLength(left.url) - pathLength(right.url))[0];
}

function hostOf(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}

function pathLength(value: string | null | undefined): number {
	if (!value) return Number.MAX_SAFE_INTEGER;
	try {
		return new URL(value).pathname.length;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}

function cleanTitle(
	value: string | null | undefined,
	domain: string,
): string | null {
	const title = clean(value);
	if (!title) return domain;
	for (const separator of [" | ", " — ", " – "]) {
		const first = title.split(separator)[0]?.trim();
		if (first && first.length >= 2) return first;
	}
	return title;
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function retryable(error: unknown): boolean {
	if (!(error instanceof TavilyApiError)) return true;
	return error.status === 408 || error.status === 429 || error.status >= 500;
}

function describe(error: unknown): string {
	if (error instanceof TavilyApiError) {
		if (error.status === 401) return "Tavily rejected the API key.";
		if (error.status === 429) return "Tavily rate-limited this request.";
		if (error.status === 432 || error.status === 433) {
			return "Tavily has no credits available for this request.";
		}
	}
	return error instanceof Error ? error.message : String(error);
}
