"use client";

import ChatInput from "@/components/chat-input";
import ChatSidebar from "@/components/chat/ChatSidebar";
import MessagesArea from "@/components/chat/MessagesArea";
import { useChatParameters } from "@/hooks/useChatParameters";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useState, useCallback } from "react";

/**
 * Main chat page component
 * Provides a full-featured chat interface with model selection,
 * parameter controls, and tool support
 */
export default function Chat() {
  // Using a single fixed model
  const selectedModel = process.env.NEXT_PUBLIC_AI_MODEL || "openai-gpt-4.1";
  const [debugMode, setDebugMode] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);

  const {
    parameters,
    handleParameterChange,
    updateMaxOutputTokens,
    getHeaders,
  } = useChatParameters();

  // Set up keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "k",
      ctrlOrCmd: true,
      action: () => window.location.reload(),
    },
  ]);

  // Initialize chat with AI SDK
  const {
    error,
    status,
    sendMessage,
    messages,
    regenerate,
    stop,
    addToolResult,
  } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: () => ({
        ...getHeaders(),
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Handle client-side tools that are automatically executed
    async onToolCall({ toolCall }) {
      console.log("Tool call received:", toolCall);
      // Return undefined to let interactive tools be handled by the UI
      // askForConfirmation is an interactive tool that requires user input
      return undefined;
    },
    onError: (error) => {
      console.error("Chat error:", error);
      // The error object might contain more details
      if (error && typeof error === "object" && "message" in error) {
        console.log("Error details:", error.message);
      }
    },
  });

  // Model is fixed, no need to change it
  const handleModelChange = useCallback(
    (model: string, maxTokens?: number) => {
      if (maxTokens) {
        updateMaxOutputTokens(maxTokens);
      }
    },
    [updateMaxOutputTokens]
  );

  const handleNewChat = useCallback(() => {
    window.location.reload();
  }, []);

  const handleToggleDebug = useCallback(() => {
    setDebugMode(!debugMode);
  }, [debugMode]);

  const handleSendMessage = useCallback(
    (text: string) => {
      const headers = {
        ...getHeaders(),
      };
      sendMessage({ text }, { headers });
    },
    [getHeaders, sendMessage]
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages area - scrollable */}
        <MessagesArea
          messages={messages}
          status={status}
          error={error || null}
          addToolResult={addToolResult}
          stop={stop}
          regenerate={regenerate}
          debug={debugMode}
        />

        {/* Input area - fixed at bottom */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-4">
          <ChatInput status={status} onSubmit={handleSendMessage} stop={stop} />
        </div>
      </div>

      {/* Right sidebar */}
      <ChatSidebar
        selectedModel={selectedModel}
        parameters={parameters}
        onParameterChange={handleParameterChange}
        onNewChat={handleNewChat}
        debugMode={debugMode}
        onToggleDebug={handleToggleDebug}
        width={sidebarWidth}
        onResize={setSidebarWidth}
      />
    </div>
  );
}
