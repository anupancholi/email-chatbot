'use client';

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useRef, FormEvent } from "react";


interface ChatMessage {
  sender: string;
  type: "text" | "screenshot";
  content: string;
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { sender: "agent", type: "text", content: "Hi! How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { sender: "user", type: "text", content: input };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 32);


    setMessages(msgs => [...msgs, { sender: "agent", type: "text", content: "..." }]);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, history: newHistory })
      });
      const data = await res.json();
      // Support both single reply (old) and multi ('replies')
      let replyMessages: ChatMessage[] = [];
      if (data.replies && Array.isArray(data.replies)) {
        replyMessages = data.replies;
      } else if (data.reply) {
        replyMessages = [data.reply];
      } else {
        replyMessages = [{ sender: "agent", type: "text", content: "Sorry, I ran into an error." }];
      }
      // Unfold stepwise if array
      if (replyMessages.length > 1) {
        // Remove loading bubble
        setMessages(msgs => [...msgs.slice(0, -1)]);
        for (let i = 0; i < replyMessages.length; i++) {
          await new Promise(r => setTimeout(r, 400));
          setMessages(msgs => [...msgs, replyMessages[i]]);
          setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 96);
        }
      } else {
        setMessages(msgs => [
          ...msgs.slice(0, -1), // remove loading
          ...replyMessages
        ]);
      }
    } catch {
      setMessages(msgs => [
        ...msgs.slice(0, -1),
        { sender: "agent", type: "text", content: "[Network error]" }
      ]);
    }
    setLoading(false);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 96);
  };

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <div className="w-full max-w-xl flex flex-col border-r bg-white min-h-screen">
        <Card className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`rounded-lg px-4 py-2 max-w-[85%] ${msg.sender === "user" ? "bg-zinc-200" : "bg-zinc-100 border"}`}>
                {msg.type === "text"
                  ? <span>{msg.content}</span>
                  : <img src={msg.content} className="rounded shadow max-w-[280px] max-h-[160px]" alt="Browser step" />
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg px-4 py-2 max-w-[85%] bg-zinc-100 border">
                <span className="animate-pulse">
                  Processing<span className="inline-block w-2">&nbsp;</span>
                  <span className="animate-bounce">⏳</span>
                </span>
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </Card>
        <form onSubmit={handleSend} className="p-2 flex gap-2 border-t bg-white">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a command..." autoFocus maxLength={400} disabled={loading} />
          <Button type="submit" className="shrink-0" disabled={loading}>Send</Button>
        </form>
      </div>
      <div className="flex-1 bg-zinc-50 p-8 hidden lg:flex flex-col items-center justify-center text-zinc-500">
        <span className="text-xl font-bold mb-2">AI Browser Agent</span>
        <span className="mb-4">Screenshots and agent status will appear inline ⬅️ in the chat.</span>
        <span className="italic">created by Anurodh with ❤️</span>
      </div>
    </div>
  );
}
