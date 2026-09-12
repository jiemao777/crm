"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionState } from "eve/client";
import { useRef } from "react";
import type { Conversation } from "@/components/crm/agent-conversations";
import { useTRPC } from "@/lib/trpc/client";

export type ConversationRecord = {
	contactId?: string;
	companyId?: string;
	dealId?: string;
};

export function useSavedConversation({
	record,
	conversation,
	opening,
}: {
	record: ConversationRecord;
	conversation: Conversation | null;
	opening: React.RefObject<string | null>;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const save = useMutation(trpc.conversations.save.mutationOptions({}));
	const written = useRef<string | null>(null);

	const persist = (session: SessionState, messageCount: number): void => {
		const sessionId = session.sessionId;
		if (!sessionId) return;
		const token = session.continuationToken ?? null;
		const streamIndex = session.streamIndex ?? 0;
		const cursor = `${sessionId}:${token ?? ""}:${streamIndex}:${messageCount}`;
		if (written.current === cursor) return;
		written.current = cursor;

		const isNew =
			conversation === null || conversation.sessionId !== session.sessionId;
		save.mutate(
			{
				...record,
				sessionId,
				continuationToken: token,
				streamIndex,
				messageCount,
				...(isNew ? { title: opening.current ?? undefined } : {}),
			},
			{
				onSuccess: () => {
					if (!isNew) return;
					void queryClient.invalidateQueries({
						queryKey: trpc.conversations.list.pathKey(),
					});
				},
			},
		);
	};

	return {
		onSessionChange: (session: SessionState) => {
			persist(session, conversation?.messageCount ?? 0);
		},
		onFinish: (snapshot: {
			session: SessionState;
			data: { messages: readonly unknown[] };
		}) => {
			persist(snapshot.session, snapshot.data.messages.length);
		},
	};
}
