"use client";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, User, Minus, Bot, MessageCircle } from "lucide-react";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
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
    const timer = setTimeout(() => {
      setShowInitialMessage(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isOpen, isMinimized]);

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

        const normalized = history.map((m: any, idx: number) => ({
          id: `h-${idx}`,
          text: m?.message ?? m?.text ?? m?.content ?? JSON.stringify(m),
          isUser: (m?.sender ?? m?.role) === "user",
          timestamp: new Date(),
        }));
        setMessages((prev) => {
          const keepGreeting = prev?.length ? prev.slice(0, 1) : [];
          return [...keepGreeting, ...normalized];
        });
      } catch {
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

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const extractText = (d: any): string | undefined => {
        if (!d) return undefined;
        if (typeof d === "string") return d;
        return (
          d.text ??
          d.message ??
          d.response ??
          d.output ??
          d.data ??
          (Array.isArray(d?.messages) ? d.messages.at(-1)?.message : undefined)
        );
      };

      return extractText(data) ?? "Sorry, I couldn't read the response.";
    } catch (error) {
      console.error("Błąd n8n:", error);
      return "There was an error talking to the server.";
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    const messageText = inputValue;
    setInputValue("");
    setIsTyping(true);

    const responseText = await sendMessageToN8n(messageText);

    const aiMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: responseText,
      isUser: false,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, aiMessage]);
    setIsTyping(false);
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

  return (
    <>
      <div id="hidden-n8n-chat" style={{ display: "none" }} />
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">

        {/* Initial Message Bubble */}
        <AnimatePresence>
          {showInitialMessage && !isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mb-4 mr-2 max-w-sm"
            >
              <div className="bg-gray-800 text-gray-200 rounded-2xl rounded-br-sm shadow-xl p-4 relative border border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm font-semibold text-gray-300">Bailey is online</span>
                  </div>
                  <button
                    onClick={closeMessage}
                    className="hover:bg-gray-700 rounded-full p-1 transition-colors"
                  >
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
              className="fixed bottom-6 right-4 w-120 max-w-[calc(100vw-2rem)] bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden"
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
                      isMinimized ? maximizeChat() : minimizeChat();
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

              {/* Messages and Input */}
              <motion.div
                animate={{
                  height: isMinimized ? 0 : "auto",
                  opacity: isMinimized ? 0 : 1,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                {/* Messages */}
                <div className="h-[50vh] overflow-y-auto p-4 space-y-4 bg-gray-800 scrollbar-hide">
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`flex items-start space-x-2 max-w-[80%] ${message.isUser ? "flex-row-reverse space-x-reverse" : ""
                          }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.isUser
                            ? "bg-blue-600"
                            : "bg-gray-600"
                            }`}
                        >
                          {message.isUser ? (
                            <User className="w-4 h-4 text-white" />
                          ) : (
                            <Bot className="w-4 h-4 text-gray-300" />
                          )}
                        </div>
                        <div className="flex flex-col space-y-1">
                          <div
                            className={`rounded-2xl px-4 py-2 ${message.isUser
                              ? "bg-blue-600 text-white"
                              : "bg-gray-700 text-gray-200 border border-gray-600"
                              }`}
                          >
                            <p className="text-sm leading-relaxed">{message.text}</p>
                          </div>
                          <p
                            className={`text-xs px-2 text-gray-400 ${message.isUser ? "text-right" : "text-left"
                              }`}
                          >
                            {message.timestamp.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {/* Typing Indicator */}
                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
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