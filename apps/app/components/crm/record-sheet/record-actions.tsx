"use client";

import OverflowMenuVertical from "@carbon/icons-react/es/OverflowMenuVertical";
import TrashCan from "@carbon/icons-react/es/TrashCan";
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
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import {
	type RecordKind,
	type RecordRef,
	useRecordStack,
} from "./record-stack";

const NOUN: Record<RecordKind, TranslationKey> = {
	company: "common.record.company",
	contact: "common.record.contact",
	deal: "common.record.deal",
};

function useDeleteRecord(record: RecordRef) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { close } = useRecordStack();

	const handlers = {
		onSuccess: (deleted: { name: string }) => {
			toast.success(
				t("common.deleted", {
					name: deleted.name || t(NOUN[record.kind]),
				}),
			);
			void cache.removed(record);
			close();
		},
		onError: (error: { message: string }) => toast.error(error.message),
	};

	const options =
		record.kind === "contact"
			? trpc.contacts.delete.mutationOptions(handlers)
			: record.kind === "company"
				? trpc.companies.delete.mutationOptions(handlers)
				: trpc.deals.delete.mutationOptions(handlers);

	return useMutation(options);
}

export function RecordActions({
	record,
	name,
	consequence,
}: {
	record: RecordRef;
	name: string;
	consequence: string;
}) {
	const { t } = useLanguage();
	const [confirming, setConfirming] = useState(false);
	const remove = useDeleteRecord(record);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" disabled={remove.isPending}>
						<Icon icon={OverflowMenuVertical} />
						<span className="sr-only">{t("common.moreActions")}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setConfirming(true)}
					>
						<Icon icon={TrashCan} />
						{t("common.deleteRecord", { record: t(NOUN[record.kind]) })}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("common.deleteConfirm", { name })}
						</AlertDialogTitle>
						<AlertDialogDescription>{consequence}</AlertDialogDescription>
					</AlertDialogHeader>

					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => remove.mutate({ id: record.id })}
						>
							{t("common.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
