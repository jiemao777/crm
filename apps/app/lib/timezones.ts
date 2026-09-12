export const TIMEZONES = [
	"Pacific/Auckland",
	"Australia/Sydney",
	"Asia/Tokyo",
	"Asia/Seoul",
	"Asia/Shanghai",
	"Asia/Hong_Kong",
	"Asia/Taipei",
	"Asia/Singapore",
	"Asia/Bangkok",
	"Asia/Jakarta",
	"Asia/Dhaka",
	"Asia/Kolkata",
	"Asia/Karachi",
	"Asia/Dubai",
	"Asia/Riyadh",
	"Asia/Jerusalem",
	"Europe/Moscow",
	"Europe/Istanbul",
	"Africa/Cairo",
	"Africa/Johannesburg",
	"Europe/Berlin",
	"Europe/Paris",
	"Europe/Madrid",
	"Europe/Rome",
	"Europe/Amsterdam",
	"Europe/Stockholm",
	"Europe/Warsaw",
	"Europe/London",
	"America/Sao_Paulo",
	"America/Argentina/Buenos_Aires",
	"America/Santiago",
	"America/Bogota",
	"America/Mexico_City",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/New_York",
	"America/Toronto",
	"America/Vancouver",
	"Pacific/Honolulu",
] as const;

function utcOffsetLabel(timeZone: string, at: Date): string {
	const part = new Intl.DateTimeFormat("en-US", {
		timeZone,
		timeZoneName: "shortOffset",
	})
		.formatToParts(at)
		.find((entry) => entry.type === "timeZoneName")?.value;
	return (part ?? "GMT").replace("GMT", "UTC");
}

export function timezoneOptions(at = new Date()) {
	return TIMEZONES.map((value) => ({
		value,
		label: `${value.replace(/_/g, " ")} (${utcOffsetLabel(value, at)})`,
	}));
}

export function buyerLocalTime(
	timeZone: string,
	locale: string,
	at = new Date(),
): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			timeZone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
		}).format(at);
	} catch {
		return timeZone;
	}
}

export function buyerHour(timeZone: string, at = new Date()): number | null {
	try {
		const part = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour: "numeric",
			hour12: false,
		})
			.formatToParts(at)
			.find((entry) => entry.type === "hour")?.value;
		if (part === undefined) return null;
		const hour = Number(part);
		if (!Number.isFinite(hour)) return null;
		return hour === 24 ? 0 : hour;
	} catch {
		return null;
	}
}

export function isBuyerWorkingHours(
	timeZone: string,
	at = new Date(),
): boolean | null {
	const hour = buyerHour(timeZone, at);
	if (hour === null) return null;
	return hour >= 8 && hour < 19;
}
