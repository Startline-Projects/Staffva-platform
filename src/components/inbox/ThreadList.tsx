"use client";

interface Thread {
  thread_id: string;
  other_party_name: string;
  unread_count: number;
  latest_message: {
    body: string;
    created_at: string;
    sender_type: string;
  };
}

interface Props {
  threads: Thread[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  userRole: string;
}

export default function ThreadList({
  threads,
  activeThreadId,
  onSelect,
  userRole,
}: Props) {
  if (threads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-text/60">No messages yet</p>
          <p className="mt-1 text-xs text-text/40">
            {userRole === "client"
              ? "Browse candidates and start a conversation."
              : "You'll see messages here when a client reaches out."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {threads.map((thread) => {
        const isActive = thread.thread_id === activeThreadId;
        const time = new Date(thread.latest_message.created_at);
        const timeStr = time.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const prefix =
          thread.latest_message.sender_type === userRole ? "You: " : "";

        return (
          <button
            key={thread.thread_id}
            onClick={() => onSelect(thread.thread_id)}
            className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
              isActive ? "bg-primary/5 border-l-2 border-primary" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">
                {thread.other_party_name}
              </span>
              <span className="text-xs text-text/40">{timeStr}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <p className="truncate text-xs text-text/60 pr-2">
                {prefix}
                {thread.latest_message.body}
              </p>
              {thread.unread_count > 0 && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                  {thread.unread_count}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
