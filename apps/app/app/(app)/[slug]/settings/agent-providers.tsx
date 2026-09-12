"use client";

import type {
	AgentProviderKind,
	AgentProviderProtocol,
	AgentProviderVerificationReason,
} from "@crm/db/agent-provider";
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
} from "@crm/ui/components/alert-dialog";
import { Badge } from "@crm/ui/components/badge";
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
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	KeyRound,
	Pencil,
	PlugZap,
	Plus,
	ServerCog,
	Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const LEGACY_PROVIDER = "__legacy__";

const PROTOCOL_NAMES: Record<AgentProviderProtocol, string> = {
	gateway: "Vercel AI Gateway",
	"openai-chat": "OpenAI Chat Completions",
	"openai-responses": "OpenAI Responses",
	"anthropic-messages": "Anthropic Messages",
	"google-generative-ai": "Google Generative AI",
};

type ProviderPreset = {
	kind: AgentProviderKind;
	name: string;
	protocol: AgentProviderProtocol;
	baseUrl: string | null;
	apiKeyRequired: boolean;
};

type ProviderRow = {
	id: string;
	name: string;
	kind: string;
	protocol: string;
	baseUrl: string | null;
	apiKeyHint: string | null;
	modelId: string;
	contextWindowTokens: number;
};

type ProviderForm = {
	id?: string;
	name: string;
	kind: AgentProviderKind;
	protocol: AgentProviderProtocol;
	baseUrl: string;
	apiKey: string;
	apiKeyHint: string | null;
	modelId: string;
	contextWindowTokens: number;
};

function newProviderForm(preset: ProviderPreset): ProviderForm {
	return {
		name: preset.name,
		kind: preset.kind,
		protocol: preset.protocol,
		baseUrl: preset.baseUrl ?? "",
		apiKey: "",
		apiKeyHint: null,
		modelId: "",
		contextWindowTokens: 128_000,
	};
}

const VERIFICATION_REASON_KEYS: Record<
	AgentProviderVerificationReason,
	TranslationKey
> = {
	"agent-not-configured": "settings.verificationAgentNotConfigured",
	"agent-unreachable": "settings.verificationAgentUnreachable",
	"invalid-configuration": "settings.verificationInvalidConfiguration",
	"provider-invalid-key": "settings.verificationInvalidKey",
	"provider-empty-response": "settings.verificationEmptyResponse",
	"provider-unavailable": "settings.verificationProviderUnavailable",
	"verification-failed": "settings.verificationFailed",
};

function editProviderForm(provider: ProviderRow): ProviderForm {
	return {
		id: provider.id,
		name: provider.name,
		kind: provider.kind as AgentProviderKind,
		protocol: provider.protocol as AgentProviderProtocol,
		baseUrl: provider.baseUrl ?? "",
		apiKey: "",
		apiKeyHint: provider.apiKeyHint,
		modelId: provider.modelId,
		contextWindowTokens: provider.contextWindowTokens,
	};
}

export function AgentProviders() {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const formId = useId();
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const settings = useQuery(trpc.settings.agentProviders.queryOptions());
	const [form, setForm] = useState<ProviderForm | null>(null);
	const [removeProvider, setRemoveProvider] = useState<ProviderRow | null>(
		null,
	);

	const refresh = async () => {
		await cache.settings();
	};

	const save = useMutation(
		trpc.settings.saveAgentProvider.mutationOptions({
			gcTime: 0,
			onSuccess: async () => {
				await refresh();
				setForm(null);
				toast.success(t("settings.providerSaved"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const test = useMutation(
		trpc.settings.testAgentProvider.mutationOptions({
			gcTime: 0,
			onSuccess: (result) => {
				if (result.outcome === "valid") {
					toast.success(t("settings.providerValid"));
				} else if (result.outcome === "invalid") {
					toast.error(
						t("settings.providerInvalid", {
							reason: t(VERIFICATION_REASON_KEYS[result.reason]),
						}),
					);
				} else {
					toast.info(
						t("settings.providerUnknown", {
							reason: t(VERIFICATION_REASON_KEYS[result.reason]),
						}),
					);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const activate = useMutation(
		trpc.settings.activateAgentProvider.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success(t("settings.providerActivated"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.settings.deleteAgentProvider.mutationOptions({
			onSuccess: async () => {
				await refresh();
				setRemoveProvider(null);
				toast.success(t("settings.providerDeleted"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!settings.data || !workspace.data) return null;

	const {
		activeProviderId,
		credentialStorageAvailable,
		legacyModelId,
		presets,
		providers,
	} = settings.data;
	const canManage = workspace.data.canRename;
	const selectedProvider = activeProviderId ?? LEGACY_PROVIDER;
	const activePreset = form
		? presets.find((preset) => preset.kind === form.kind)
		: null;
	const requiresNewKey = Boolean(
		activePreset?.apiKeyRequired && !form?.apiKeyHint,
	);

	const input = (value: ProviderForm) => ({
		...(value.id ? { id: value.id } : {}),
		name: value.name.trim(),
		kind: value.kind,
		protocol: value.protocol,
		baseUrl: value.baseUrl.trim() || null,
		apiKey: value.apiKey.trim() || null,
		modelId: value.modelId.trim(),
		contextWindowTokens: value.contextWindowTokens,
	});

	const validateForm = (value: ProviderForm): string | null => {
		const preset = presets.find((item) => item.kind === value.kind);
		if (!value.name.trim()) return t("settings.formNameRequired");
		const baseUrl = value.baseUrl.trim();
		if (!baseUrl) return t("settings.formBaseUrlRequired");
		try {
			const url = new URL(baseUrl);
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.username ||
				url.password
			) {
				return t("settings.formBaseUrlInvalid");
			}
		} catch {
			return t("settings.formBaseUrlInvalid");
		}
		if (preset?.apiKeyRequired && !value.apiKeyHint && !value.apiKey.trim()) {
			return t("settings.formApiKeyRequired");
		}
		if (!value.modelId.trim()) return t("settings.formModelIdRequired");
		if (
			!Number.isInteger(value.contextWindowTokens) ||
			value.contextWindowTokens < 4_096 ||
			value.contextWindowTokens > 10_000_000
		) {
			return t("settings.formContextWindowInvalid");
		}
		return null;
	};

	const openNewProvider = () => {
		const first = presets[0];
		if (first) setForm(newProviderForm(first));
	};

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.researchAgent")}</CardTitle>
					<CardDescription>
						{t("settings.researchAgentDescription")}
					</CardDescription>
					<CardAction>
						<Button
							type="button"
							disabled={!canManage}
							onClick={openNewProvider}
						>
							<Plus data-icon="inline-start" />
							{t("settings.addProvider")}
						</Button>
					</CardAction>
				</CardHeader>

				<CardContent className="flex flex-col gap-4">
					{!credentialStorageAvailable ? (
						<Alert>
							<KeyRound />
							<AlertTitle>
								{t("settings.credentialStorageUnavailable")}
							</AlertTitle>
							<AlertDescription>
								{t("settings.credentialStorageDescription")}
							</AlertDescription>
						</Alert>
					) : null}

					<Field>
						<FieldLabel htmlFor="active-agent-provider">
							{t("settings.activeProvider")}
						</FieldLabel>
						<Select
							value={selectedProvider}
							disabled={!canManage || activate.isPending}
							onValueChange={(providerId) =>
								activate.mutate({
									providerId:
										providerId === LEGACY_PROVIDER ? null : providerId,
								})
							}
						>
							<SelectTrigger id="active-agent-provider">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value={LEGACY_PROVIDER}>
										{t("settings.legacyEnvironment", {
											model: legacyModelId,
										})}
									</SelectItem>
									{providers.map((provider) => (
										<SelectItem key={provider.id} value={provider.id}>
											{provider.name} — {provider.modelId}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>

					{providers.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ServerCog />
								</EmptyMedia>
								<EmptyTitle>{t("settings.noProviders")}</EmptyTitle>
								<EmptyDescription>
									{t("settings.noProvidersDescription")}
								</EmptyDescription>
							</EmptyHeader>
							{canManage ? (
								<EmptyContent>
									<Button type="button" onClick={openNewProvider}>
										<Plus data-icon="inline-start" />
										{t("settings.addProvider")}
									</Button>
								</EmptyContent>
							) : null}
						</Empty>
					) : (
						<FieldGroup>
							{providers.map((provider) => (
								<Field key={provider.id} orientation="horizontal">
									<div className="flex min-w-0 flex-1 flex-col gap-1">
										<div className="flex items-center gap-2">
											<FieldLabel>{provider.name}</FieldLabel>
											{provider.id === activeProviderId ? (
												<Badge variant="secondary">{t("common.active")}</Badge>
											) : null}
										</div>
										<FieldDescription>
											{provider.modelId} ·{" "}
											{provider.apiKeyHint ?? t("settings.keyless")}
										</FieldDescription>
									</div>
									<div className="flex shrink-0 gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											disabled={!canManage}
											onClick={() => setForm(editProviderForm(provider))}
										>
											<Pencil />
											<span className="sr-only">{t("common.edit")}</span>
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											disabled={!canManage}
											onClick={() => setRemoveProvider(provider)}
										>
											<Trash2 />
											<span className="sr-only">{t("common.delete")}</span>
										</Button>
									</div>
								</Field>
							))}
						</FieldGroup>
					)}

					{!canManage ? (
						<p className="text-muted-foreground text-xs">
							{t("settings.adminOnly")}
						</p>
					) : null}
				</CardContent>
			</Card>

			<Dialog
				open={form !== null}
				onOpenChange={(open) => !open && setForm(null)}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{form?.id
								? t("settings.editProvider")
								: t("settings.addProvider")}
						</DialogTitle>
						<DialogDescription>
							{t("settings.providerDialogDescription")}
						</DialogDescription>
					</DialogHeader>

					{form ? (
						<form
							id={formId}
							onSubmit={(event) => {
								event.preventDefault();
								const problem = validateForm(form);
								if (problem) {
									toast.error(problem);
									return;
								}
								save.mutate(input(form));
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="agent-provider-kind">
										{t("settings.provider")}
									</FieldLabel>
									<Select
										value={form.kind}
										onValueChange={(kind) => {
											const preset = presets.find((item) => item.kind === kind);
											if (!preset) return;
											setForm({
												...form,
												kind: preset.kind,
												name: form.id ? form.name : preset.name,
												protocol: preset.protocol,
												baseUrl: preset.baseUrl ?? "",
											});
										}}
									>
										<SelectTrigger id="agent-provider-kind">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{presets.map((preset) => (
													<SelectItem key={preset.kind} value={preset.kind}>
														{preset.name}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>

								<Field>
									<FieldLabel htmlFor="agent-provider-name">
										{t("settings.providerName")}
									</FieldLabel>
									<Input
										id="agent-provider-name"
										value={form.name}
										onChange={(event) =>
											setForm({ ...form, name: event.target.value })
										}
										required
									/>
									<FieldDescription>
										{t("settings.providerNameDescription")}
									</FieldDescription>
								</Field>

								{form.kind === "custom" ? (
									<Field>
										<FieldLabel htmlFor="agent-provider-protocol">
											{t("settings.protocol")}
										</FieldLabel>
										<Select
											value={form.protocol}
											onValueChange={(protocol) =>
												setForm({
													...form,
													protocol: protocol as AgentProviderProtocol,
												})
											}
										>
											<SelectTrigger id="agent-provider-protocol">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{Object.entries(PROTOCOL_NAMES)
														.filter(([protocol]) => protocol !== "gateway")
														.map(([protocol, name]) => (
															<SelectItem key={protocol} value={protocol}>
																{name}
															</SelectItem>
														))}
												</SelectGroup>
											</SelectContent>
										</Select>
									</Field>
								) : null}

								<Field>
									<FieldLabel htmlFor="agent-provider-url">
										{t("settings.baseUrl")}
									</FieldLabel>
									<Input
										id="agent-provider-url"
										value={form.baseUrl}
										onChange={(event) =>
											setForm({ ...form, baseUrl: event.target.value })
										}
										inputMode="url"
										required
									/>
								</Field>

								<Field>
									<FieldLabel htmlFor="agent-provider-key">
										{t("settings.apiKey")}
									</FieldLabel>
									<Input
										id="agent-provider-key"
										type="password"
										value={form.apiKey}
										onChange={(event) =>
											setForm({ ...form, apiKey: event.target.value })
										}
										placeholder={
											form.apiKeyHint
												? t("settings.keyStored", {
														hint: form.apiKeyHint,
													})
												: undefined
										}
										required={requiresNewKey}
										autoComplete="new-password"
									/>
									<FieldDescription>
										{t("settings.apiKeyDescription")}
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel htmlFor="agent-provider-model">
										{t("settings.modelId")}
									</FieldLabel>
									<Input
										id="agent-provider-model"
										value={form.modelId}
										onChange={(event) =>
											setForm({ ...form, modelId: event.target.value })
										}
										placeholder="model-id"
										required
									/>
									<FieldDescription>
										{t("settings.modelIdDescription")}
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel htmlFor="agent-provider-context">
										{t("settings.contextWindow")}
									</FieldLabel>
									<Input
										id="agent-provider-context"
										type="number"
										min={4_096}
										max={10_000_000}
										step={1_000}
										value={form.contextWindowTokens}
										onChange={(event) =>
											setForm({
												...form,
												contextWindowTokens: Number(event.target.value),
											})
										}
										required
									/>
									<FieldDescription>
										{t("settings.contextWindowDescription")}
									</FieldDescription>
								</Field>
							</FieldGroup>
						</form>
					) : null}

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								{t("common.cancel")}
							</Button>
						</DialogClose>
						<Button
							type="button"
							variant="outline"
							disabled={!form || test.isPending || save.isPending}
							onClick={() => {
								if (!form) return;
								const problem = validateForm(form);
								if (problem) {
									toast.error(problem);
									return;
								}
								test.mutate(input(form));
							}}
						>
							{test.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<PlugZap data-icon="inline-start" />
							)}
							{test.isPending
								? t("settings.testingConnection")
								: t("settings.testConnection")}
						</Button>
						<Button
							type="submit"
							form={formId}
							disabled={!form || save.isPending}
						>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							{t("common.save")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={removeProvider !== null}
				onOpenChange={(open) => !open && setRemoveProvider(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings.removeProvider")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings.removeProviderDescription", {
								name: removeProvider?.name ?? "",
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => {
								if (removeProvider) {
									remove.mutate({ providerId: removeProvider.id });
								}
							}}
						>
							{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
							{t("common.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
