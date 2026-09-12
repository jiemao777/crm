"use client";

import { Spinner } from "@crm/ui/components/spinner";
import { useRef } from "react";
import {
	ConversationPicker,
	useConversations,
} from "@/components/crm/agent-conversations";
import { AgentThreadWithHistory } from "@/components/crm/agent-thread";
import {
	type AgentRecord,
	recordCopy,
	recordFilter,
	recordHeader,
} from "@/lib/agent-record";
import { NEW_THREAD, resolveThread } from "@/lib/agent-transcript";
import { useRecordSheetView } from "./record-sheet/record-stack";

export function AgentPanel({ record }: { record: AgentRecord }) {
	const conversations = useConversations(recordFilter(record));
	const { thread, setThread } = useRecordSheetView("overview");
	const history = conversations.data ?? [];
	const landedOn = useRef<string | null>(null);

	if (landedOn.current === null && conversations.isSuccess) {
		landedOn.current = history[0]?.id ?? NEW_THREAD;
	}

	const { openId, current } = resolveThread({
		conversations: history,
		fromUrl: thread,
		landedOn: landedOn.current,
	});

	if (conversations.isPending) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ConversationPicker
				conversations={history}
				current={current}
				onSelect={(conversation) => setThread(conversation.id)}
				onNew={() => setThread(NEW_THREAD)}
				busy={false}
			/>

			<AgentThreadWithHistory
				key={openId ?? NEW_THREAD}
				conversation={current}
				headers={recordHeader(record)}
				record={recordFilter(record)}
				copy={recordCopy(record.kind)}
				onNewThread={() => setThread(NEW_THREAD)}
			/>
		</div>
	);
}
