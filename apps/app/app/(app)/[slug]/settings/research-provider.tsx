"use client";

import type { ResearchProviderKind } from "@crm/db/research-provider";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

type ResearchSettings = {
	configured: boolean;
	kind: ResearchProviderKind | null;
	hint: string | null;
	keyless: boolean;
	credentialStorageAvailable: boolean;
	presets: readonly {
		kind: ResearchProviderKind;
		name: string;
		signupUrl: string;
		apiKeyRequired: boolean;
	}[];
};

export function ResearchProvider() {
	const trpc = useTRPC();
	const settings = useQuery(trpc.settings.researchProvider.queryOptions());
	if (!settings.data) return null;

	return (
		<ResearchProviderCard
			key={`${settings.data.kind ?? "none"}:${settings.data.hint ?? "keyless"}`}
			settings={settings.data}
		/>
	);
}

function ResearchProviderCard({ settings }: { settings: ResearchSettings }) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const formId = useId();
	const providerId = useId();
	const keyId = useId();
	const [kind, setKind] = useState<ResearchProviderKind>(
		settings.kind ?? "tavily",
	);
	const [draft, setDraft] = useState("");
	const preset = settings.presets.find((item) => item.kind === kind);
	const providerChanged = kind !== settings.kind;
	const hasDraft = draft.trim().length > 0;
	const canSave =
		hasDraft ||
		(kind === "tavily" && (providerChanged || !settings.configured));
	const credentialUnavailable =
		hasDraft && !settings.credentialStorageAvailable;
	const saveLabel = hasDraft
		? t("settings.saveAndEnable")
		: canSave
			? t("settings.enableKeyless")
			: t("settings.enabled");

	const save = useMutation(
		trpc.settings.setResearchProvider.mutationOptions({
			gcTime: 0,
			onSuccess: async () => {
				await cache.settings();
				setDraft("");
				toast.success(t("settings.researchProviderSaved"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const savedPreset = settings.presets.find(
		(item) => item.kind === settings.kind,
	);
	const statusLabel = settings.configured
		? settings.keyless
			? t("settings.researchKeyless")
			: t("settings.connected")
		: t("settings.notConnected");

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.companyResearch")}</CardTitle>
				<CardDescription>
					{t("settings.companyResearchDescription")}
				</CardDescription>
				<CardAction>
					<Button
						type="submit"
						form={formId}
						disabled={save.isPending || !canSave || credentialUnavailable}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						{saveLabel}
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id={formId}
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate({ kind, apiKey: draft.trim() || null });
					}}
				>
					<FieldGroup>
						<Field>
							<div className="flex items-center justify-between gap-3">
								<FieldLabel htmlFor={providerId}>
									{t("settings.researchProvider")}
								</FieldLabel>
								<StatusIndicator
									size="sm"
									tone={settings.configured ? "success" : "warning"}
									label={
										savedPreset
											? `${savedPreset.name} · ${statusLabel}`
											: statusLabel
									}
								/>
							</div>
							<Select
								value={kind}
								onValueChange={(value) =>
									setKind(value as ResearchProviderKind)
								}
								disabled={save.isPending}
							>
								<SelectTrigger id={providerId}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{settings.presets.map((item) => (
											<SelectItem key={item.kind} value={item.kind}>
												{item.name}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<FieldDescription>
								{kind === "tavily"
									? t("settings.tavilyDescription")
									: t("settings.contextDescription")}
							</FieldDescription>
						</Field>

						<Field data-invalid={credentialUnavailable || undefined}>
							<FieldLabel htmlFor={keyId}>
								{t("settings.researchApiKey", {
									provider: preset?.name ?? "",
								})}
							</FieldLabel>
							<Input
								id={keyId}
								type="password"
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								placeholder={
									settings.kind === kind && settings.hint
										? settings.hint
										: kind === "tavily"
											? t("settings.optionalApiKey")
											: t("settings.pasteKey")
								}
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
								disabled={save.isPending}
								aria-invalid={credentialUnavailable || undefined}
								required={kind === "context"}
							/>
							<FieldDescription>
								{credentialUnavailable
									? t("settings.credentialStorageDescription")
									: kind === "tavily"
										? t("settings.tavilyKeyDescription")
										: t("settings.contextKeyDescription")}{" "}
								{preset ? (
									<a
										href={preset.signupUrl}
										target="_blank"
										rel="noreferrer"
										className="underline underline-offset-4 hover:text-foreground"
									>
										{t("settings.signUp")}
									</a>
								) : null}
							</FieldDescription>
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
