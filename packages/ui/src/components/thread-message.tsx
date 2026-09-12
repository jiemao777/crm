import DOMPurify from "dompurify";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { cn } from "@crm/ui/lib/utils";
import { useEffect, useRef } from "react";
import type * as React from "react";

type ThreadAttachment = {
	id: string;
	filename: string;
	contentId?: string | null;
};

function ThreadMessage({
	from,
	fromEmail,
	fromImageUrl,
	sentAt,
	direction,
	body,
	html,
	attachments,
	attachmentBaseUrl,
	action,
	className,
	...props
}: Omit<React.ComponentProps<"article">, "children"> & {
	from: string;
	fromEmail: string;
	fromImageUrl?: string | null;
	sentAt: string;
	direction: "INBOUND" | "OUTBOUND";
	body: string | null;
	html?: string | null;
	attachments?: ThreadAttachment[];
	attachmentBaseUrl?: string;
	action?: React.ReactNode;
}) {
	const outbound = direction === "OUTBOUND";
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const root = bodyRef.current;
		if (!root) return;
		const images = [...root.querySelectorAll("img[data-cid-src]")];
		for (const img of images) {
			const target = img.getAttribute("data-cid-src");
			if (!target) continue;
			void fetch(target, { credentials: "same-origin" })
				.then((response) => {
					if (!response.ok) throw new Error("load failed");
					return response.blob();
				})
				.then(
					(blob) =>
						new Promise<string>((resolve, reject) => {
							const reader = new FileReader();
							reader.onload = () => resolve(String(reader.result));
							reader.onerror = () => reject(new Error("read failed"));
							reader.readAsDataURL(blob);
						}),
				)
				.then((dataUrl) => {
					img.setAttribute("src", dataUrl);
				})
				.catch(() => {
					// leave broken image icon
				});
		}
	}, [html, attachments]);

	const htmlWithCid = resolveCidImages(
		html,
		attachments ?? [],
		attachmentBaseUrl ?? "",
	);
	const safeHtml = htmlWithCid
		? DOMPurify.sanitize(htmlWithCid, {
				ALLOWED_TAGS: [
					"p", "br", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol",
					"li", "blockquote", "h1", "h2", "h3", "h4", "code", "pre", "table",
					"thead", "tbody", "tr", "th", "td", "span", "div", "img", "hr",
				],
				ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel", "colspan", "rowspan"],
			})
		: null;

	return (
		<article
			data-slot="thread-message"
			data-direction={direction}
			className={cn(
				"flex gap-2.5 border-l-2 py-2 pl-3",
				outbound ? "border-l-foreground/30" : "border-l-border",
				className,
			)}
			{...props}
		>
			<PersonAvatar
				src={fromImageUrl}
				name={from}
				email={fromEmail}
				size="sm"
				className="mt-0.5"
			/>

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
					<span className="font-medium text-xs">{from}</span>
					<span className="truncate text-muted-foreground text-xs">
						{fromEmail}
					</span>
					<span className="ml-auto text-muted-foreground text-xs">
						{sentAt}
					</span>
				</div>

				{safeHtml ? (
					<div
						ref={bodyRef}
						className="text-pretty text-muted-foreground text-xs/5 [&_a]:underline [&_a]:underline-offset-2 [&_img]:max-w-full [&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_li]:my-0.5"
						dangerouslySetInnerHTML={{ __html: safeHtml }}
					/>
				) : body ? (
					<p className="whitespace-pre-wrap text-pretty text-muted-foreground text-xs/5">
						{body}
					</p>
				) : (
					<p className="text-muted-foreground text-xs italic">
						No message body.
					</p>
				)}

				{action ? <div className="flex gap-3 text-xs">{action}</div> : null}
			</div>
		</article>
	);
}

function resolveCidImages(
	html: string | null | undefined,
	attachments: ThreadAttachment[],
	baseUrl: string,
): string | null {
	if (!html) return null;
	const byContentId = new Map<string, string>();
	for (const attachment of attachments) {
		if (!attachment.contentId) continue;
		const key = attachment.contentId
			.replace(/^<|>$/g, "")
			.toLowerCase();
		byContentId.set(key, `${baseUrl}/api/mail/attachments/${attachment.id}?preview=1`);
	}
	if (byContentId.size === 0) return html;
	return html.replace(
		/<img([^>]*)src=["']cid:([^"'>\s]+)["']([^>]*)>/gi,
		(_match, before: string, cid: string, after: string) => {
			const url = byContentId.get(cid.toLowerCase());
			if (!url) return _match;
			return `<img${before}data-cid-src="${url}"${after}>`;
		},
	);
}

export { ThreadMessage };
