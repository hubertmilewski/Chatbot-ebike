"use client";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, User, Minus, Bot, MessageCircle } from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  // NEW: optional quick replies from n8n
  suggestions?: string[];
}

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showInitialMessage, setShowInitialMessage] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello, I'm Bailey, your EcoRide rental assistant. How can I help you today?",
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  const CHAT_INPUT_KEY = "chatInput";
  const SESSION_KEY = "sessionId";
  const LOCAL_STORAGE_SESSION_KEY = "n8n-chat-session";

  const getSessionId = () => {
    if (typeof window === "undefined") return "";
    let sid = window.localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
    if (!sid) {
      sid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, sid);
    }
    return sid;
  };

  useEffect(() => {
    const timer = setTimeout(() => setShowInitialMessage(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isOpen && !isMinimized) scrollToBottom();
  }, [messages, isOpen, isMinimized]);

  // ---- Helpers to normalize n8n responses
  const normalizeFromN8n = (d: any): { text: string; suggestions?: string[] } => {
    // Robust JSON-string parser (handles BOM, code fences, extra text)
    const tryParse = (v: any) => {
      if (typeof v !== "string") return v;

      // 1) strip BOM + trim
      let s = v.replace(/^\uFEFF/, "").trim();

      // 2) unwrap ``` or ```json fences if present
      const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
      const m = s.match(fence);
      if (m) s = m[1].trim();

      // 3) if not starting with { or [, try to extract the first JSON-ish block
      if (!(s.startsWith("{") || s.startsWith("["))) {
        const firstBrace = s.search(/[{\[]/);
        if (firstBrace !== -1) {
          s = s.slice(firstBrace);
        }
      }

      // 4) attempt parse; if it fails, progressively trim the tail until it succeeds
      // (helps when extra characters trail after the JSON)
      let end = s.length;
      for (; end > 1; end--) {
        const candidate = s.slice(0, end).trim();
        try {
          if (candidate.startsWith("{") || candidate.startsWith("[")) {
            return JSON.parse(candidate);
          }
        } catch {
          // keep shrinking
        }
      }
      return v; // give up -> return original
    };

    // peel off stringified layers and common wrappers
    let o: any = tryParse(d);
    if (o && typeof o === "object" && "body" in o) o = tryParse(o.body);
    if (o && typeof o === "object" && "data" in o) o = tryParse(o.data);
    if (o && typeof o === "object" && "output" in o) o = tryParse(o.output);

    // text
    const text =
      (o?.text ??
        o?.message ??
        o?.response ??
        o?.output ??
        (Array.isArray(o?.messages) ? o.messages.at(-1)?.message : undefined) ??
        (typeof o === "string" ? o : undefined) ??
        "") as string;

    // suggestions from common keys
    const raw =
      o?.suggestions ??
      o?.quickReplies ??
      o?.buttons ??
      o?.choices;

    const suggestions = Array.isArray(raw)
      ? raw
        .map((x: any) =>
          typeof x === "string" ? x : x?.title ?? x?.text ?? x?.label ?? x?.name
        )
        .filter(Boolean)
      : undefined;

    return { text: String(text), suggestions };
  };

  useEffect(() => {
    const fetchHistory = async () => {
      if (!isOpen) return;
      try {
        const res = await fetch(`${WEBHOOK_URL}?action=loadPreviousSession`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [SESSION_KEY]: getSessionId() }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const history = Array.isArray(data?.messages) ? data.messages : [];
        if (!history.length) return;

        const normalized = history.map((m: any, idx: number) => {
          const { text, suggestions } = normalizeFromN8n(m);
          return {
            id: `h-${idx}`,
            text,
            suggestions,
            isUser: (m?.sender ?? m?.role) === "user",
            timestamp: new Date(),
          } as Message;
        });
        setMessages((prev) => {
          const keepGreeting = prev?.length ? prev.slice(0, 1) : [];
          return [...keepGreeting, ...normalized];
        });
      } catch {
        // ignore
      }
    };
    fetchHistory();
  }, [isOpen]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const sendMessageToN8n = async (message: string) => {
    try {
      const response = await fetch(`${WEBHOOK_URL}?action=sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [CHAT_INPUT_KEY]: message,
          [SESSION_KEY]: getSessionId(),
        }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      return normalizeFromN8n(data);
    } catch (error) {
      console.error("n8n error:", error);
      return { text: "There was an error talking to the server." };
    }
  };

  const sendNow = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: String(Date.now()),
      text: content,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    const res = await fetch(`${WEBHOOK_URL}?action=sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [CHAT_INPUT_KEY]: content, [SESSION_KEY]: getSessionId() }),
    });

    let parsed: { text: string; suggestions?: string[] };
    try {
      parsed = normalizeFromN8n(await res.json());
    } catch {
      parsed = { text: "There was an error talking to the server." };
    }

    const botMessage: Message = {
      id: String(Date.now() + 1),
      text: parsed.text,
      suggestions: parsed.suggestions,
      isUser: false,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, botMessage]);
    setIsTyping(false);
  };

  const handleSendMessage = async () => {
    const msg = inputValue;
    setInputValue("");
    await sendNow(msg);
  };

  const handleQuickReply = async (suggestion: string) => {
    await sendNow(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const openChat = () => {
    setIsOpen(true);
    setIsMinimized(false);
    setShowInitialMessage(false);
  };
  const closeMessage = () => setShowInitialMessage(false);
  const minimizeChat = () => setIsMinimized(true);
  const maximizeChat = () => setIsMinimized(false);
  const closeChat = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  // ---- UI
  return (
    <>
      <div id="hidden-n8n-chat" style={{ display: "none" }} />
      <div className="fixed bottom-6 right-4 md:right-6 z-50 flex flex-col items-end">
        {/* Initial Message Bubble */}
        <AnimatePresence>
          {showInitialMessage && !isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mb-4 max-w-sm"
            >
              <div className="bg-gray-800 text-gray-200 rounded-2xl rounded-br-sm shadow-xl p-4 relative border border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm font-semibold text-gray-300">Bailey is online</span>
                  </div>
                  <button onClick={closeMessage} className="hover:bg-gray-700 rounded-full p-1 transition-colors">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Hello! I'm here to help with your e-bike rental or answer any questions you may have. Click to chat!
                </p>
                <div className="absolute -bottom-2 right-6 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-t-8 border-t-gray-800"></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Modal */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed bottom-6 right-4 w-150 max-w-[calc(100vw-2rem)] bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden"
            >
              {/* Header */}
              <div
                className="bg-gradient-to-r from-gray-800/20 to-gray-800/10 text-white p-4 flex items-center justify-between cursor-pointer"
                onClick={isMinimized ? maximizeChat : undefined}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-gray-500 bg-opacity-20 backdrop-blur-sm flex items-center justify-center border border-gray-400 border-opacity-30">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                      <h3 className="font-semibold text-base">Bailey</h3>
                    </div>
                    <span className="text-blue-100 text-xs">AI Assistant</span>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isMinimized ? maximizeChat() : setIsMinimized(true);
                    }}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeChat();
                    }}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Messages + Input */}
              <motion.div
                animate={{ height: isMinimized ? 0 : "auto", opacity: isMinimized ? 0 : 1 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                {/* Messages */}
                <div className="h-[60vh] overflow-y-auto p-4 space-y-4 bg-gray-800 scrollbar-hide">
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`flex items-start space-x-2 max-w-[80%] ${message.isUser ? "flex-row-reverse space-x-reverse" : ""}`}>
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.isUser ? "bg-blue-600" : "bg-gray-600"
                            }`}
                        >
                          {message.isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-gray-300" />}
                        </div>

                        <div className="flex flex-col space-y-1">
                          <div
                            className={`rounded-2xl px-4 py-2 ${message.isUser ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-200 border border-gray-600"
                              }`}
                          >
                            {message.isUser ? (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
                            ) : (
                              <div className="prose prose-invert max-w-none text-sm">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeSanitize]}
                                  components={{
                                    p: (props) => <p className="leading-relaxed" {...props} />,
                                    ul: (props) => <ul className="list-disc ml-5 my-2" {...props} />,
                                    ol: (props) => <ol className="list-decimal ml-5 my-2" {...props} />,
                                    li: (props) => <li className="my-1" {...props} />,
                                  }}
                                >
                                  {(message.text || "").replace(/\\n/g, "\n")}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>

                          {/* NEW: Quick replies */}
                          {!message.isUser && Array.isArray(message.suggestions) && message.suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {message.suggestions.map((s, i) => (
                                <button
                                  key={`${message.id}-s-${i}`}
                                  onClick={() => handleQuickReply(s)}
                                  className="text-xs px-3 py-1 rounded-full border border-blue-400/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 transition-colors"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}

                          <p className={`text-xs px-2 text-gray-400 ${message.isUser ? "text-right" : "text-left"}`}>
                            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {/* Typing Indicator */}
                  {isTyping && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="flex items-start space-x-2">
                        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-gray-300" />
                        </div>
                        <div className="bg-gray-700 border border-gray-600 rounded-2xl px-4 py-3">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                            <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-gray-700 bg-gray-900">
                  <div className="flex items-center space-x-3">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 bg-gray-800 border border-gray-600 rounded-full px-4 py-2 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!inputValue.trim()}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-full p-2 transition-colors disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Button */}
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openChat}
              className="bg-gray-800 hover:bg-gray-700 text-white rounded-full p-4 shadow-lg transition-colors"
            >
              <MessageCircle className="w-6 h-6" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
