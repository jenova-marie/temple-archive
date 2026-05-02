/**
 * LiteratureRepository - Data access layer for literature tables
 *
 * Provides operations for querying recovery literature and text blocks.
 */

import { eq, ilike, sql, inArray } from "drizzle-orm";
import { ok, err, type Result, type DomainError } from "@siri/types";
import {
  literature,
  literatureBlocks,
  type Literature,
  type LiteratureBlock,
} from "../schema/literature.js";
import type { DatabaseClient } from "../client.js";

/**
 * Error type for LiteratureRepository operations
 */
export interface LiteratureError extends DomainError {
  kind: "DatabaseError" | "NotFound";
}

function createError(
  kind: LiteratureError["kind"],
  message: string,
  cause?: unknown,
): LiteratureError {
  return {
    kind,
    message,
    context: { cause: cause instanceof Error ? cause.message : String(cause) },
    cause,
    timestamp: Date.now(),
  };
}

/**
 * Search result combining literature metadata with matching blocks
 */
export interface LiteratureSearchResult {
  literature: Literature;
  blocks: LiteratureBlock[];
}

/**
 * Literature block with parent literature metadata
 */
export interface LiteratureBlockWithMeta {
  block: LiteratureBlock;
  literature: Literature;
}

export class LiteratureRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Find literature by ID
   */
  async findById(
    id: string,
  ): Promise<Result<Literature | null, LiteratureError>> {
    try {
      const rows = await this.db
        .select()
        .from(literature)
        .where(eq(literature.id, id))
        .limit(1);

      return ok(rows[0] ?? null);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to find literature by id: ${id}`,
          error,
        ),
      );
    }
  }

  /**
   * Search literature by title (case-insensitive)
   */
  async searchByTitle(
    query: string,
    limit = 10,
  ): Promise<Result<Literature[], LiteratureError>> {
    try {
      const rows = await this.db
        .select()
        .from(literature)
        .where(ilike(literature.title, `%${query}%`))
        .limit(limit);

      return ok(rows);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to search literature: ${query}`,
          error,
        ),
      );
    }
  }

  /**
   * Get all literature entries, optionally filtered by fellowship
   */
  async findAll(
    limit = 50,
    fellowship?: string,
  ): Promise<Result<Literature[], LiteratureError>> {
    try {
      let query = this.db.select().from(literature);

      if (fellowship) {
        query = query.where(
          eq(literature.fellowship, fellowship),
        ) as typeof query;
      }

      const rows = await query.limit(limit);

      return ok(rows);
    } catch (error) {
      return err(
        createError("DatabaseError", "Failed to find all literature", error),
      );
    }
  }

  /**
   * Find literature by fellowship
   */
  async findByFellowship(
    fellowship: string,
    limit = 50,
  ): Promise<Result<Literature[], LiteratureError>> {
    try {
      const rows = await this.db
        .select()
        .from(literature)
        .where(eq(literature.fellowship, fellowship))
        .limit(limit);

      return ok(rows);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to find literature for fellowship: ${fellowship}`,
          error,
        ),
      );
    }
  }

  /**
   * Get blocks for a specific literature entry
   */
  async getBlocks(
    literatureId: string,
    limit = 100,
  ): Promise<Result<LiteratureBlock[], LiteratureError>> {
    try {
      const rows = await this.db
        .select()
        .from(literatureBlocks)
        .where(eq(literatureBlocks.literatureId, literatureId))
        .orderBy(literatureBlocks.page, literatureBlocks.lineStart)
        .limit(limit);

      return ok(rows);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to get blocks for: ${literatureId}`,
          error,
        ),
      );
    }
  }

  /**
   * Search for text within literature blocks (case-insensitive)
   * Returns blocks matching the query along with their parent literature metadata
   */
  async searchBlocks(
    query: string,
    limit = 20,
  ): Promise<Result<LiteratureSearchResult[], LiteratureError>> {
    try {
      // Search blocks that match the query
      const matchingBlocks = await this.db
        .select({
          block: literatureBlocks,
          lit: literature,
        })
        .from(literatureBlocks)
        .innerJoin(literature, eq(literatureBlocks.literatureId, literature.id))
        .where(ilike(literatureBlocks.text, `%${query}%`))
        .limit(limit);

      // Group blocks by literature
      const resultMap = new Map<string, LiteratureSearchResult>();

      for (const row of matchingBlocks) {
        const litId = row.lit.id;
        if (!resultMap.has(litId)) {
          resultMap.set(litId, {
            literature: row.lit,
            blocks: [],
          });
        }
        resultMap.get(litId)!.blocks.push(row.block);
      }

      return ok(Array.from(resultMap.values()));
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to search blocks: ${query}`,
          error,
        ),
      );
    }
  }

  /**
   * Get a specific block by page number
   */
  async getBlockByPage(
    literatureId: string,
    page: number,
  ): Promise<Result<LiteratureBlock[], LiteratureError>> {
    try {
      const rows = await this.db
        .select()
        .from(literatureBlocks)
        .where(
          sql`${literatureBlocks.literatureId} = ${literatureId} AND ${literatureBlocks.page} = ${page}`,
        )
        .orderBy(literatureBlocks.lineStart);

      return ok(rows);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to get block at page ${page}`,
          error,
        ),
      );
    }
  }

  /**
   * Insert a new literature entry
   */
  async insert(
    data: Omit<Literature, "id" | "createdAt" | "updatedAt">,
  ): Promise<Result<Literature, LiteratureError>> {
    try {
      const [row] = await this.db.insert(literature).values(data).returning();

      return ok(row);
    } catch (error) {
      return err(
        createError("DatabaseError", "Failed to insert literature", error),
      );
    }
  }

  /**
   * Insert a block for a literature entry
   */
  async insertBlock(
    data: Omit<LiteratureBlock, "id" | "createdAt">,
  ): Promise<Result<LiteratureBlock, LiteratureError>> {
    try {
      const [row] = await this.db
        .insert(literatureBlocks)
        .values(data)
        .returning();

      return ok(row);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          "Failed to insert literature block",
          error,
        ),
      );
    }
  }

  /**
   * Insert multiple blocks at once
   */
  async insertBlocks(
    data: Omit<LiteratureBlock, "id" | "createdAt">[],
  ): Promise<Result<LiteratureBlock[], LiteratureError>> {
    try {
      const rows = await this.db
        .insert(literatureBlocks)
        .values(data)
        .returning();

      return ok(rows);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          "Failed to insert literature blocks",
          error,
        ),
      );
    }
  }

  /**
   * Delete a literature entry and all its blocks (cascade)
   */
  async delete(
    id: string,
  ): Promise<Result<Literature | null, LiteratureError>> {
    try {
      const [row] = await this.db
        .delete(literature)
        .where(eq(literature.id, id))
        .returning();

      return ok(row ?? null);
    } catch (error) {
      return err(
        createError(
          "DatabaseError",
          `Failed to delete literature: ${id}`,
          error,
        ),
      );
    }
  }

  /**
   * Get blocks by their IDs with parent literature metadata
   * Used for hydrating Qdrant search results
   */
  async getBlocksByIds(
    blockIds: string[],
  ): Promise<Result<LiteratureBlockWithMeta[], LiteratureError>> {
    if (blockIds.length === 0) {
      return ok([]);
    }

    try {
      const rows = await this.db
        .select({
          block: literatureBlocks,
          literature: literature,
        })
        .from(literatureBlocks)
        .innerJoin(literature, eq(literatureBlocks.literatureId, literature.id))
        .where(inArray(literatureBlocks.id, blockIds));

      return ok(rows);
    } catch (error) {
      return err(
        createError("DatabaseError", `Failed to get blocks by IDs`, error),
      );
    }
  }
}
