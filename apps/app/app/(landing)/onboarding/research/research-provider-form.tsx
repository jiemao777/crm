"use client";

import {
	RESEARCH_PROVIDER_PRESETS,
	type ResearchProviderKind,
} from "@crm/db/research-provider";
import { Button } from "@crm/ui/components/button";
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
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";

export function ResearchProviderForm() {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const router = useRouter();
	const providerId = useId();
	const keyId = useId();
	const [kind, setKind] = useState<ResearchProviderKind>("tavily");
	const [apiKey, setApiKey] = useState("");
	const preset = RESEARCH_PROVIDER_PRESETS.find((item) => item.kind === kind);

	const save = useMutation(
		trpc.settings.setResearchProvider.mutationOptions({
			gcTime: 0,
			onSuccess: () => {
				router.refresh();
				router.replace("/");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate({ kind, apiKey: apiKey.trim() || null });
			}}
			className="flex flex-col gap-6"
		>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={providerId}>
						{t("settings.researchProvider")}
					</FieldLabel>
					<Select
						value={kind}
						onValueChange={(value) => setKind(value as ResearchProviderKind)}
						disabled={save.isPending}
					>
						<SelectTrigger id={providerId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{RESEARCH_PROVIDER_PRESETS.map((item) => (
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

				<Field>
					<FieldLabel htmlFor={keyId}>
						{t("settings.researchApiKey", {
							provider: preset?.name ?? "",
						})}
					</FieldLabel>
					<Input
						id={keyId}
						name="apiKey"
						type="password"
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						placeholder={
							kind === "tavily"
								? t("settings.optionalApiKey")
								: t("settings.pasteKey")
						}
						autoComplete="off"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						autoFocus={kind === "context"}
						required={kind === "context"}
						disabled={save.isPending}
					/>
					<FieldDescription>
						{kind === "tavily"
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

			<Button
				type="submit"
				disabled={save.isPending || (kind === "context" && !apiKey.trim())}
			>
				{save.isPending ? <Spinner data-icon="inline-start" /> : null}
				{t("onboarding.continue")}
			</Button>
		</form>
	);
}
