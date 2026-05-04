import type { Guide } from "@siri/shared";
import { apiClient } from "./client";

interface GuidesResponse {
  guides: Guide[];
}

/**
 * Fetch the list of available guides from the agent API.
 * Backed by the `system_prompts` table (rows where `active = true`).
 */
export async function fetchGuides(): Promise<Guide[]> {
  const response = await apiClient<GuidesResponse>("/api/v1/guides");
  return response.guides ?? [];
}
