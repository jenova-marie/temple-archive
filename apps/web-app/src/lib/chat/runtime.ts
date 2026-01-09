import { useMemo, useState } from "react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

// Authenticated chat endpoint - requires authentication
const CHAT_API_URL =
  import.meta.env.VITE_AUTH_CHAT_API_URL || `${API_BASE_URL}/api/v1/chat`;

export function useMeetingGuideRuntime() {
  const user = useAuthStore((s) => s.user);
  const selectedGuideId = useChatStore((s) => s.selectedGuideId);

  // Generate a unique conversation ID per page load
  const [conversationId] = useState(() => crypto.randomUUID());

  const transport = useMemo(() => {
    const accessToken = useAuthStore.getState().getAccessToken();

    // Auth is required - accessToken must exist
    if (!accessToken) {
      throw new Error("Authentication required for chat");
    }

    return new AssistantChatTransport({
      api: CHAT_API_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        guide: selectedGuideId,
        conversation_id: conversationId,
      },
      // Only send the latest user message - server fetches history from PostgreSQL
      // This reduces payload size and makes the server the source of truth
      prepareSendMessagesRequest: ({ messages }) => {
        // Find the last user message to send
        const lastUserMessage = messages.filter((m) => m.role === "user").slice(-1);
        return {
          body: {
            messages: lastUserMessage,
            guide: selectedGuideId,
            conversation_id: conversationId,
          },
        };
      },
    });
  }, [user?.access_token, selectedGuideId, conversationId]);

  return useChatRuntime({ transport });
}
