"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@crm/ui/components/dialog";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function DuplicatesDialog() {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [open, setOpen] = useState(false);
	const [keepByRoot, setKeepByRoot] = useState<Record<string, string>>({});
	const [merging, setMerging] = useState<string | null>(null);

	const duplicates = useQuery({
		...trpc.companies.duplicates.queryOptions(),
		enabled: open,
	});

	const merge = useMutation(
		trpc.companies.merge.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);

	const groups = duplicates.data ?? [];

	const mergeGroup = async (
		root: string,
		members: { id: string; name: string }[],
	) => {
		const keepId = keepByRoot[root] ?? members[0]?.id;
		if (!keepId) return;
		setMerging(root);
		try {
			for (const member of members) {
				if (member.id === keepId) continue;
				const result = await merge.mutateAsync({
					keepId,
					mergeId: member.id,
				});
				toast.success(t("company.merged", { name: result.merged }));
			}
			await cache.company();
			await duplicates.refetch();
		} finally {
			setMerging(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					{t("company.findDuplicates")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("company.duplicatesTitle")}</DialogTitle>
					<DialogDescription>
						{t("company.duplicatesDescription")}
					</DialogDescription>
				</DialogHeader>
				{duplicates.isPending ? (
					<div className="flex justify-center py-8">
						<Spinner />
					</div>
				) : groups.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						{t("company.noDuplicates")}
					</p>
				) : (
					<div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
						{groups.map((group) => {
							const keepId = keepByRoot[group.root] ?? group.members[0]?.id;
							return (
								<div key={group.root} className="rounded-lg border p-3">
									<p className="mb-2 font-medium text-muted-foreground text-xs">
										{group.root}
									</p>
									<div className="flex flex-col gap-1">
										{group.members.map((member) => (
											<label
												key={member.id}
												className={cn(
													"flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
													member.id === keepId
														? "border-primary"
														: "border-transparent",
												)}
											>
												<input
													type="radio"
													name={`keep-${group.root}`}
													checked={member.id === keepId}
													onChange={() =>
														setKeepByRoot((current) => ({
															...current,
															[group.root]: member.id,
														}))
													}
												/>
												<span className="min-w-0 flex-1 truncate font-medium">
													{member.name}
												</span>
												<span className="text-muted-foreground text-xs">
													{member.domain}
												</span>
												<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
													{t("company.recordsCount", {
														count: member.records,
													})}
												</span>
											</label>
										))}
									</div>
									<div className="mt-2 flex justify-end">
										<Button
											size="sm"
											disabled={merging !== null}
											onClick={() => void mergeGroup(group.root, group.members)}
										>
											{merging === group.root ? (
												<Spinner data-icon="inline-start" />
											) : null}
											{t("company.mergeOthers")}
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
