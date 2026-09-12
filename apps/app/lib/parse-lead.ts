export type ParsedLead = {
	name: string;
	domain: string;
	email: string | null;
	personName: string | null;
	phone: string | null;
	leadSource: string | null;
	productInterest: string | null;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:^|[^\w@])(\+?\d[\d\s().-]{5,}\d)(?![\w@])/gm;
const URL_RE =
	/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:com|net|org|co|io|cn|de|fr|it|es|uk|au|jp|in|com\.cn|co\.uk|com\.au)[a-zA-Z0-9.-]*)/;
const NOISE_DOMAINS = new Set([
	"gmail.com",
	"yahoo.com",
	"hotmail.com",
	"outlook.com",
	"qq.com",
	"163.com",
	"126.com",
	"ingcho.com",
]);

function titleCase(value: string): string {
	return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function phoneFrom(text: string): string | null {
	for (const match of text.matchAll(PHONE_RE)) {
		const candidate = match[1]?.trim();
		if (!candidate) continue;
		const digits = candidate.replace(/\D/g, "");
		if (digits.length >= 7 && digits.length <= 15) return candidate;
	}
	return null;
}

export function parseLeadText(text: string): ParsedLead {
	const trimmed = text.trim();
	const lower = trimmed.toLowerCase();

	const emailMatch = trimmed.match(EMAIL_RE);
	const email = emailMatch?.[0]?.toLowerCase() ?? null;
	const domainFromEmail = email?.split("@")[1] ?? null;

	const field = (label: string): string | null => {
		const pattern = new RegExp(
			`(?:^|\\n)\\s*${label}\\s*[::]?\\s*([^\\n]+)`,
			"i",
		);
		const match = trimmed.match(pattern);
		const value = match?.[1]?.trim();
		return value && value.length > 0 ? value : null;
	};

	const fieldName = field("Name");
	const fieldEmail = field("Email")?.toLowerCase() ?? null;
	const fieldPhone = field("Phone");
	const fieldCompany = field("Company");

	let personName: string | null = fieldName
		? fieldName.replace(/[,\s]+/g, " ").trim()
		: null;
	if (!personName && fieldEmail) {
		const [local] = fieldEmail.split("@");
		if (local && !/^[0-9]+$/.test(local)) {
			personName = titleCase(local.replace(/[._-]+/g, " ")).trim();
		}
	}
	if (!personName && email) {
		const [local] = email.split("@");
		if (local && !/^[0-9]+$/.test(local)) {
			personName = titleCase(local.replace(/[._-]+/g, " ")).trim();
		}
	}

	const phone = fieldPhone?.trim() ?? phoneFrom(trimmed);
	const leadSource = lower.includes("ingcho.com")
		? "Homepage inquiry"
		: lower.includes("alibaba")
			? "Alibaba"
			: lower.includes("whatsapp")
				? "WhatsApp"
				: null;

	const urlMatch = trimmed.match(URL_RE);
	const domainFromUrl = urlMatch?.[1];
	const urlDomainIsNoise =
		domainFromUrl &&
		(NOISE_DOMAINS.has(domainFromUrl) ||
			/looking|ingcho|chatgpt|wix|wordpress|weebly/i.test(domainFromUrl));

	let domain: string | null = null;
	if (domainFromEmail && !NOISE_DOMAINS.has(domainFromEmail)) {
		domain = domainFromEmail;
	} else if (domainFromUrl && !urlDomainIsNoise) {
		domain = domainFromUrl;
	}

	let name = fieldCompany ?? "";
	if (!name && personName) {
		name = personName;
	}
	if (!name && domain) {
		name = titleCase(
			domain
				.replace(/\.(com|net|org|co|io|cn|de|fr|it|es|uk|au|jp|in)$/i, "")
				.replace(/[.-]+/g, " "),
		).trim();
	}

	let productInterest: string | null = null;
	const detailAnchor = lower.indexOf("project details");
	const productAnchor = lower.indexOf("product:");
	const searchFrom = Math.max(detailAnchor + 15, productAnchor, 0);
	const candidates: { index: number; label: string }[] = [];
	for (const keyword of [
		"product",
		"borosilicate",
		"inquiry",
		"quote",
		"looking for",
	]) {
		const idx = lower.indexOf(keyword, searchFrom);
		if (idx >= 0) candidates.push({ index: idx, label: keyword });
	}
	candidates.sort((a, b) => a.index - b.index);
	const firstCandidate = candidates[0];
	if (firstCandidate) {
		const { index } = firstCandidate;
		productInterest = trimmed
			.slice(index, index + 140)
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 200);
	}

	return {
		name: name.replace(/\s+/g, " ").trim(),
		domain: domain ?? "",
		email: fieldEmail ?? email,
		personName,
		phone,
		leadSource,
		productInterest,
	};
}
