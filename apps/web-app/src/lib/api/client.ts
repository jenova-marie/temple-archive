import { useAuthStore } from "@/stores/authStore";

// Empty/unset → relative paths so requests go through Vite's /api proxy in
// dev and the same-origin reverse proxy in production. Override only when
// the API really lives on a different origin.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const accessToken = useAuthStore.getState().getAccessToken();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  if (accessToken) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Handle 401 Unauthorized - token may be expired
    if (response.status === 401) {
      useAuthStore.getState().clearAuth();
    }
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
