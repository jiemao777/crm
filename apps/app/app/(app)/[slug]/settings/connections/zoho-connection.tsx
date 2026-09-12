"use client";

import Warning from "@carbon/icons-react/es/Warning";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
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
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { isSyncing, SYNC_POLL_MS } from "@/components/crm/sync-status";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/i18n-core";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const REGIONS = [
	{ host: "imap.zoho.com", key: "zoho.region.us" },
	{ host: "imap.zoho.eu", key: "zoho.region.eu" },
	{ host: "imap.zoho.in", key: "zoho.region.india" },
	{ host: "imap.zoho.com.au", key: "zoho.region.australia" },
	{ host: "imap.zoho.jp", key: "zoho.region.japan" },
	{ host: "imap.zoho.com.cn", key: "zoho.region.china" },
	{ host: "imap.zoho.sa", key: "zoho.region.saudi" },
] as const satisfies readonly { host: string; key: TranslationKey }[];

export function ZohoConnection() {
	const { language, t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const emailId = useId();
	const passwordId = useId();
	const regionId = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [host, setHost] =
		useState<(typeof REGIONS)[number]["host"]>("imap.zoho.com");

	const status = useQuery({
		...trpc.google.zohoStatus.queryOptions(),
		refetchInterval: (query) =>
			isSyncing(query.state.data?.status ?? null) ? SYNC_POLL_MS : false,
	});

	const connect = useMutation(
		trpc.google.connectZoho.mutationOptions({
			onSuccess: async () => {
				setPassword("");
				setReconnecting(false);
				await cache.zoho({ settle: "record" });
				toast.success(t("zoho.connected"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const sync = useMutation(
		trpc.google.syncZohoNow.mutationOptions({
			onSuccess: () => cache.zoho({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const backfill = useMutation(
		trpc.google.backfillZoho.mutationOptions({
			onSuccess: () => cache.zoho({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const autoCreate = useMutation(
		trpc.google.setZohoAutoCreate.mutationOptions({
			onSuccess: () => cache.zoho({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const disconnect = useMutation(
		trpc.google.disconnectZoho.mutationOptions({
			onSuccess: async () => {
				await cache.zoho({ settle: "record" });
				toast.success(t("zoho.disconnected"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;

	if (!status.data.configured) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Zoho Mail</CardTitle>
					<CardDescription>
						{t("zoho.notConfiguredDescription")}
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

	if (!status.data.connected) {
		const complete = email.trim() !== "" && password !== "";

		return (
			<Card>
				<CardHeader>
					<CardTitle>Zoho Mail</CardTitle>
					<CardDescription>{t("zoho.connectDescription")}</CardDescription>
					<CardAction>
						<StatusIndicator
							size="sm"
							tone="neutral"
							label={t("settings.notConnected")}
						/>
					</CardAction>
				</CardHeader>

				<CardContent>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							connect.mutate({ email: email.trim(), password, host });
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={emailId}>{t("zoho.email")}</FieldLabel>
								<Input
									id={emailId}
									type="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									placeholder="sales@yourcompany.com"
									autoComplete="email"
									required
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor={passwordId}>
									{t("zoho.appPassword")}
								</FieldLabel>
								<Input
									id={passwordId}
									type="password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									autoComplete="new-password"
									required
								/>
								<FieldDescription>
									{t("zoho.appPasswordDescription")}
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor={regionId}>{t("zoho.region")}</FieldLabel>
								<Select
									value={host}
									onValueChange={(value) => {
										if (REGIONS.some((region) => region.host === value)) {
											setHost(value as (typeof REGIONS)[number]["host"]);
										}
									}}
								>
									<SelectTrigger id={regionId}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{REGIONS.map((region) => (
												<SelectItem key={region.host} value={region.host}>
													{t(region.key)}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						</FieldGroup>

						<Button type="submit" disabled={!complete || connect.isPending}>
							{connect.isPending ? <Spinner data-icon="inline-start" /> : null}
							{t("zoho.connect")}
						</Button>
					</form>
				</CardContent>
			</Card>
		);
	}

	const failed =
		status.data.status === "NEEDS_RECONNECT" || status.data.lastError;
	const healthy = !failed;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Zoho Mail</CardTitle>
				<CardDescription>
					{t("zoho.connectedDescription", {
						email: status.data.email ?? "",
					})}
				</CardDescription>
				<CardAction>
					<StatusIndicator
						size="sm"
						tone={healthy ? "success" : "warning"}
						label={healthy ? t("settings.connected") : t("zoho.needsAttention")}
					/>
					<Button
						variant="contrast"
						size="sm"
						disabled={
							sync.isPending || status.data.status === "NEEDS_RECONNECT"
						}
						onClick={() => sync.mutate()}
					>
						{sync.isPending ? t("zoho.checking") : t("zoho.checkNow")}
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				{failed ? (
					<>
						<Alert variant="destructive">
							<Icon icon={Warning} />
							<AlertTitle>{t("zoho.syncFailed")}</AlertTitle>
							<AlertDescription>
								{status.data.lastError ?? t("zoho.reconnectDescription")}
							</AlertDescription>
						</Alert>

						{reconnecting ? (
							<form
								className="flex flex-col gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									connect.mutate({
										email: status.data.email ?? "",
										password,
										host: (status.data.host ??
											"imap.zoho.com") as (typeof REGIONS)[number]["host"],
									});
								}}
							>
								<Field>
									<FieldLabel htmlFor={passwordId}>
										{t("zoho.newAppPassword")}
									</FieldLabel>
									<Input
										id={passwordId}
										type="password"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										autoComplete="new-password"
										required
									/>
								</Field>
								<div className="flex items-center gap-2">
									<Button
										type="submit"
										size="sm"
										disabled={!password || connect.isPending}
									>
										{connect.isPending ? (
											<Spinner data-icon="inline-start" />
										) : null}
										{t("zoho.reconnect")}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											setPassword("");
											setReconnecting(false);
										}}
									>
										{t("common.cancel")}
									</Button>
								</div>
							</form>
						) : (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setReconnecting(true)}
							>
								{t("zoho.reconnectWithPassword")}
							</Button>
						)}
					</>
				) : (
					<p className="text-muted-foreground text-xs">
						{status.data.lastSyncedAt
							? t("zoho.lastChecked", {
									time: formatRelativeTime(status.data.lastSyncedAt, language),
								})
							: t("zoho.waitingFirstCheck")}
					</p>
				)}

				<div className="flex items-center justify-between gap-6">
					<FieldLabel
						htmlFor="zoho-auto-create"
						className="flex flex-col items-start gap-1"
					>
						<span className="text-sm">{t("zoho.autoCreate")}</span>
						<span className="font-normal text-muted-foreground text-xs">
							{t("zoho.autoCreateDescription")}
						</span>
					</FieldLabel>
					<Switch
						id="zoho-auto-create"
						checked={status.data.autoCreate}
						disabled={autoCreate.isPending}
						onCheckedChange={(enabled) => autoCreate.mutate({ enabled })}
					/>
				</div>
			</CardContent>

			<CardFooter className="justify-between">
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="outline" size="xs" disabled={backfill.isPending}>
							{backfill.isPending
								? t("zoho.downloading")
								: t("zoho.downloadHistory")}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{t("zoho.downloadConfirm")}</AlertDialogTitle>
							<AlertDialogDescription>
								{t("zoho.downloadDescription")}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
							<AlertDialogAction onClick={() => backfill.mutate()}>
								{t("common.download")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="ghost" size="xs" disabled={disconnect.isPending}>
							{t("zoho.disconnect")}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{t("zoho.disconnectConfirm")}</AlertDialogTitle>
							<AlertDialogDescription>
								{t("zoho.disconnectDescription")}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => disconnect.mutate()}
							>
								{t("zoho.disconnect")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardFooter>
		</Card>
	);
}
