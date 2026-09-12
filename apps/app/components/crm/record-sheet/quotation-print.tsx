"use client";

import Document from "@carbon/icons-react/es/Document";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { useLanguage } from "@/lib/i18n";

type QuotationLine = {
	id: string;
	productName: string;
	sku: string | null;
	specification: string | null;
	quantity: number;
	unit: string | null;
	unitPriceCents: number;
};

type QuotationForPrint = {
	quoteNumber: string;
	version: number;
	currency: string;
	incoterm: string | null;
	originPort: string | null;
	destinationPort: string | null;
	paymentTerms: string | null;
	leadTimeDays: number | null;
	validUntil: string | null;
	notes: string | null;
	subtotalCents: number;
	totalCents: number;
	items: QuotationLine[];
};

type InquiryForPrint = {
	name: string;
	inquiryNo: string | null;
	company: { name: string };
};

function formatMoney(cents: number, currency: string): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
	}).format(cents / 100);
}

export function PrintQuotationButton({
	inquiry,
	quotation,
}: {
	inquiry: InquiryForPrint;
	quotation: QuotationForPrint;
}) {
	const { t } = useLanguage();
	function handlePrint() {
		const win = window.open("", "_blank", "width=800,height=900");
		if (!win) return;

		win.document.write(`
			<!DOCTYPE html>
			<html>
				<head>
					<meta charset="utf-8" />
					<title>${quotation.quoteNumber} v${quotation.version}</title>
					<style>
						* { box-sizing: border-box; margin: 0; padding: 0; }
						body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #111; padding: 32px; line-height: 1.5; }
						h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
						.meta { color: #555; margin-bottom: 24px; }
						.meta-row { display: flex; gap: 24px; margin-bottom: 16px; flex-wrap: wrap; }
						.meta-item { min-width: 140px; }
						.meta-label { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.05em; }
						.meta-value { font-size: 12px; font-weight: 500; }
						table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
						th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #777; padding: 8px 6px; border-bottom: 1px solid #ddd; }
						td { padding: 10px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
						.text-right { text-align: right; }
						.total-row td { font-weight: 600; border-top: 2px solid #111; border-bottom: none; padding-top: 12px; }
						.notes { margin-top: 24px; padding: 12px; background: #f5f5f5; border-radius: 4px; }
						.notes-label { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
						@media print { body { padding: 0; } }
					</style>
				</head>
				<body>
					<h1>Quotation ${quotation.quoteNumber}</h1>
					<div class="meta">
						Version ${quotation.version} · ${inquiry.name}${inquiry.inquiryNo ? ` · ${inquiry.inquiryNo}` : ""} · ${inquiry.company.name}
					</div>
					<div class="meta-row">
						${quotation.incoterm ? `<div class="meta-item"><div class="meta-label">Incoterm</div><div class="meta-value">${quotation.incoterm}</div></div>` : ""}
						${quotation.originPort ? `<div class="meta-item"><div class="meta-label">Origin</div><div class="meta-value">${quotation.originPort}</div></div>` : ""}
						${quotation.destinationPort ? `<div class="meta-item"><div class="meta-label">Destination</div><div class="meta-value">${quotation.destinationPort}</div></div>` : ""}
						${quotation.leadTimeDays ? `<div class="meta-item"><div class="meta-label">Lead time</div><div class="meta-value">${quotation.leadTimeDays} days</div></div>` : ""}
						${quotation.validUntil ? `<div class="meta-item"><div class="meta-label">Valid until</div><div class="meta-value">${new Date(quotation.validUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div></div>` : ""}
						${quotation.paymentTerms ? `<div class="meta-item"><div class="meta-label">Payment</div><div class="meta-value">${quotation.paymentTerms}</div></div>` : ""}
					</div>
					<table>
						<thead>
							<tr>
								<th>Product</th>
								<th>Specification</th>
								<th class="text-right">Qty</th>
								<th class="text-right">Unit price</th>
								<th class="text-right">Total</th>
							</tr>
						</thead>
						<tbody>
							${quotation.items
								.map(
									(item) => `
								<tr>
									<td>${item.productName}${item.sku ? ` · ${item.sku}` : ""}</td>
									<td>${item.specification || "—"}</td>
									<td class="text-right">${item.quantity}${item.unit ? ` ${item.unit}` : ""}</td>
									<td class="text-right">${formatMoney(item.unitPriceCents, quotation.currency)}</td>
									<td class="text-right">${formatMoney(item.unitPriceCents * item.quantity, quotation.currency)}</td>
								</tr>`,
								)
								.join("")}
							<tr class="total-row">
								<td colspan="4" class="text-right">Subtotal</td>
								<td class="text-right">${formatMoney(quotation.subtotalCents, quotation.currency)}</td>
							</tr>
							<tr class="total-row">
								<td colspan="4" class="text-right">Total</td>
								<td class="text-right">${formatMoney(quotation.totalCents, quotation.currency)}</td>
							</tr>
						</tbody>
					</table>
					${quotation.notes ? `<div class="notes"><div class="notes-label">Notes</div><div>${quotation.notes.replace(/\n/g, "<br/>")}</div></div>` : ""}
				</body>
			</html>
		`);
		win.document.close();
		win.focus();
		setTimeout(() => {
			win.print();
			win.close();
		}, 300);
	}

	return (
		<Button
			type="button"
			size="sm"
			variant="outline"
			onClick={handlePrint}
			className="shrink-0"
		>
			<Icon icon={Document} data-icon="inline-start" />
			{t("quotation.exportPdf")}
		</Button>
	);
}
