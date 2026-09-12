"use client";

import Launch from "@carbon/icons-react/es/Launch";
import Warning from "@carbon/icons-react/es/Warning";
import { authClient } from "@crm/auth/client";
import { SYNC_SCOPES } from "@crm/auth/scopes";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@crm/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@crm/ui/components/alert-dialog";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { isSyncing, SYNC_POLL_MS } from "@/components/crm/sync-status";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/i18n-core";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const SOURCES = {
	calendar: {
		label: "google.meetings",
		autoCreate: "google.meetingsAutoCreate",
	},
	gmail: {
		label: "google.email",
		autoCreate: "google.emailAutoCreate",
	},
} as const satisfies Record<
	string,
	{ label: TranslationKey; autoCreate: TranslationKey }
>;

const RESOLVE_HOSTS = [
	"console.cloud.google.com",
	"console.developers.google.com",
	"support.google.com",
	"myaccount.google.com",
];

function resolveLink(error: string): string | undefined {
	const found = error.match(/https?:\/\/[^\s)]+/)?.[0];
	if (!found) return undefined;

	try {
		const url = new URL(found);
		const allowed =
			url.protocol === "https:" &&
			RESOLVE_HOSTS.some(
				(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
			);
		return allowed ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function explain(error: string) {
	return {
		summary: error.split(/(?<=\.)\s/)[0] ?? error,
		url: resolveLink(error),
	};
}

function failureSignature(
	sources: readonly {
		source: string;
		status: string | null;
		lastError: string | null;
	}[],
): string {
	return sources
		.filter((source) => source.status === "NEEDS_RECONNECT" || source.lastError)
		.map((source) => `${source.source}:${source.lastError ?? "reconnect"}`)
		.sort()
		.join("|");
}

function GoogleUnavailable() {
	const { t } = useLanguage();
	return (
		<Card>
			<CardHeader>
				<CardTitle>Google</CardTitle>
				<CardDescription>
					{t("google.notConfiguredDescription")}
				</CardDescription>

				<CardAction>
					<StatusIndicator
						size="sm"
						tone="neutral"
						label={t("settings.notConfigured")}
					/>
				</CardAction>
			</CardHeader>
		</Card>
	);
}

const CONNECT_ERRORS: Record<string, TranslationKey> = {
	"email_doesn't_match": "google.emailMismatch",
};

function ConnectGoogle({ connectError }: { connectError?: string }) {
	const { t } = useLanguage();
	const [pending, setPending] = useState(false);

	async function handleConnect() {
		setPending(true);

		const origin = window.location.origin;

		const { error } = await authClient.linkSocial({
			provider: "google",
			scopes: [...SYNC_SCOPES],
			callbackURL: `${origin}/settings/connections`,
			errorCallbackURL: `${origin}/settings/connections`,
		});

		if (error) {
			toast.error(error.message ?? t("google.unreachable"));
			setPending(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Google</CardTitle>
				<CardDescription>{t("google.connectDescription")}</CardDescription>

				<CardAction>
					<StatusIndicator
						size="sm"
						tone="neutral"
						label={t("settings.notConnected")}
					/>
				</CardAction>
			</CardHeader>

			<CardContent>
				{connectError ? (
					<Alert variant="destructive">
						<Icon icon={Warning} />
						<AlertTitle>{t("google.connectFailed")}</AlertTitle>
						<AlertDescription>
							{CONNECT_ERRORS[connectError]
								? t(CONNECT_ERRORS[connectError])
								: t("google.connectFailedDescription")}
						</AlertDescription>
					</Alert>
				) : null}

				<Button disabled={pending} onClick={handleConnect} type="button">
					{pending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<GoogleLogo data-icon="inline-start" className="size-4" />
					)}
					{t("google.connect")}
				</Button>

				<p className="text-muted-foreground text-xs">
					{t("google.privacyNote")}
				</p>
			</CardContent>
		</Card>
	);
}

export function GoogleConnection({ connectError }: { connectError?: string }) {
	const { language, t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();

	const status = useQuery({
		...trpc.google.status.queryOptions(),
		refetchInterval: (query) =>
			query.state.data?.sources.some((source) => isSyncing(source.status))
				? SYNC_POLL_MS
				: false,
	});

	const purge = useMutation(
		trpc.google.purgeSyncedData.mutationOptions({
			onSuccess: async (result) => {
				await cache.google();
				toast.success(t("google.removedItems", { count: result.purged }));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const revoke = useMutation(
		trpc.google.revokeAccess.mutationOptions({
			onSuccess: () =>
				window.location.assign(
					status.data?.required ? "/" : "/settings/connections",
				),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setAutoCreate = useMutation(
		trpc.google.setAutoCreate.mutationOptions({
			onSuccess: () => cache.google({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const [insistence, setInsistence] = useState(0);

	const syncNow = useMutation(
		trpc.google.syncNow.mutationOptions({
			onSuccess: async () => {
				const before = failureSignature(status.data?.sources ?? []);
				await cache.google();

				const after = failureSignature(
					queryClient.getQueryData(trpc.google.status.queryKey())?.sources ??
						[],
				);

				if (after && after === before) setInsistence((count) => count + 1);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;

	const { sources, hasRefreshToken, configured, linked, required } =
		status.data;

	if (!configured) return <GoogleUnavailable />;
	if (!linked) return <ConnectGoogle connectError={connectError} />;

	const failing = sources.filter(
		(source) => source.status === "NEEDS_RECONNECT" || source.lastError,
	);
	const lastSyncedAt = sources
		.map((source) => source.lastSyncedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);

	const healthy = failing.length === 0 && hasRefreshToken;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Google</CardTitle>
				<CardDescription>{t("google.connectedDescription")}</CardDescription>

				<CardAction>
					<StatusIndicator
						size="sm"
						tone={healthy ? "success" : "warning"}
						label={
							healthy ? t("settings.connected") : t("google.needsAttention")
						}
					/>

					<Button
						variant="contrast"
						size="sm"
						disabled={syncNow.isPending}
						onClick={() => syncNow.mutate()}
					>
						{syncNow.isPending ? t("zoho.checking") : t("zoho.checkNow")}
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				{!hasRefreshToken ? (
					<Alert variant="destructive" attention={insistence}>
						<Icon icon={Warning} />
						<AlertTitle>{t("google.refreshTokenMissing")}</AlertTitle>
						<AlertDescription>{t("google.signInAgain")}</AlertDescription>
					</Alert>
				) : failing.length > 0 ? (
					failing.map((source) => {
						const { summary, url } = explain(
							source.lastError ?? t("google.needsReconnect"),
						);

						return (
							<Alert
								key={source.source}
								variant="destructive"
								attention={insistence}
							>
								<Icon icon={Warning} />
								<AlertTitle>
									{t("google.syncFailed", {
										source: t(SOURCES[source.source].label),
									})}
								</AlertTitle>
								<AlertDescription>{summary}</AlertDescription>

								{url ? (
									<AlertAction>
										<Button variant="contrast" size="xs" asChild>
											<a href={url} target="_blank" rel="noreferrer">
												{t("google.resolve")}
												<Icon icon={Launch} data-icon="inline-end" />
											</a>
										</Button>
									</AlertAction>
								) : null}
							</Alert>
						);
					})
				) : (
					<p className="text-muted-foreground text-xs">
						{lastSyncedAt
							? t("google.lastChecked", {
									time: formatRelativeTime(lastSyncedAt, language),
								})
							: t("google.waitingFirstCheck")}
					</p>
				)}

				{sources.map((source) => {
					const copy = SOURCES[source.source];

					return (
						<div
							key={source.source}
							className="flex items-center justify-between gap-6"
						>
							<Label
								htmlFor={`auto-create-${source.source}`}
								className="flex flex-col items-start gap-1"
							>
								<span className="text-sm">{t(copy.label)}</span>
								<span className="font-normal text-muted-foreground text-xs">
									{t(copy.autoCreate)}
								</span>
							</Label>

							<Switch
								id={`auto-create-${source.source}`}
								checked={source.autoCreate}
								disabled={setAutoCreate.isPending}
								onCheckedChange={(enabled) =>
									setAutoCreate.mutate({ source: source.source, enabled })
								}
							/>
						</div>
					);
				})}

				<CardFooter>
					<div className="-ml-2 flex flex-wrap items-center gap-1 text-muted-foreground">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="xs" disabled={purge.isPending}>
									{t("google.deleteData")}
								</Button>
							</AlertDialogTrigger>

							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("google.deleteDataConfirm")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t("google.deleteDataDescription")}
									</AlertDialogDescription>
								</AlertDialogHeader>

								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => purge.mutate()}
									>
										{t("common.delete")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="xs" disabled={revoke.isPending}>
									{t("google.revoke")}
								</Button>
							</AlertDialogTrigger>

							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("google.revokeConfirm")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{required
											? t("google.revokeRequiredDescription")
											: t("google.revokeDescription")}
									</AlertDialogDescription>
								</AlertDialogHeader>

								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => revoke.mutate()}
									>
										{t("google.revoke")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<Button variant="ghost" size="xs" asChild>
							<Link
								href="https://myaccount.google.com/permissions"
								target="_blank"
								rel="noreferrer"
							>
								{t("google.manageAccount")}
							</Link>
						</Button>
					</div>
				</CardFooter>
			</CardContent>
		</Card>
	);
}
