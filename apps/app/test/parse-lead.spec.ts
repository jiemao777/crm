import { describe, expect, it } from "bun:test";
import { parseLeadText } from "../lib/parse-lead";

describe("parseLeadText", () => {
	it("extracts company and contact fields from labelled inquiry text", () => {
		const parsed = parseLeadText(`
Company: Acme Imports
Name: Jane Doe
Email: JANE@ACME.COM
Phone: +1 415 555 0199
Website: https://www.acme.com
Project details: Looking for borosilicate tubing for laboratory equipment.
`);

		expect(parsed.name).toBe("Acme Imports");
		expect(parsed.personName).toBe("Jane Doe");
		expect(parsed.email).toBe("jane@acme.com");
		expect(parsed.phone).toBe("+1 415 555 0199");
		expect(parsed.domain).toBe("acme.com");
		expect(parsed.productInterest).toContain("Looking for borosilicate");
	});

	it("derives an unlabelled contact name and phone from an email signature", () => {
		const parsed = parseLeadText(`
Please quote 500 units.
alex.chen@northstar.io
+86 138 0013 8000
`);

		expect(parsed.name).toBe("Alex Chen");
		expect(parsed.personName).toBe("Alex Chen");
		expect(parsed.email).toBe("alex.chen@northstar.io");
		expect(parsed.phone).toBe("+86 138 0013 8000");
		expect(parsed.domain).toBe("northstar.io");
	});

	it("does not treat free or sender-owned domains as the customer domain", () => {
		const parsed = parseLeadText(`
Name: Priya Shah
Email: priya@gmail.com
Submitted from https://ingcho.com/contact
Alibaba inquiry for glassware
`);

		expect(parsed.name).toBe("Priya Shah");
		expect(parsed.domain).toBe("");
		expect(parsed.leadSource).toBe("Homepage inquiry");
	});
});
