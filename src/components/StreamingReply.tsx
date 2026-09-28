import type { MentionPeer } from "@/lib/mentions";
import { ChatMarkdown } from "./ChatMarkdown";

/** The in-progress assistant text. The settled transcript replaces this row
 * when its message arrives, so the partial reply has no message actions. */
export function StreamingReply({
  text,
  mentionPeers,
  everyone = false,
  speakerName,
}: {
  text: string;
  mentionPeers?: readonly MentionPeer[];
  everyone?: boolean;
  speakerName?: string;
}) {
  if (!text.trim()) return null;
  return (
    <div className="flex w-full flex-col items-start" data-streaming-reply aria-live="off">
      {speakerName && <div className="mb-1 px-1 text-[11.5px] font-medium text-ink-secondary">{speakerName}</div>}
      <div className="w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <ChatMarkdown text={text} streaming mentionPeers={mentionPeers} everyone={everyone} />
      </div>
    </div>
  );
}
