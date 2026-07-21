// Type-check harness for docs/search.md. Compile-only — never executed.
import {
  Model,
  search,
  reindex,
  registerSearchable,
  setSearchDriver,
  searchDriver,
  searchMigration,
  documentText,
  MemorySearchDriver,
  DatabaseSearchDriver,
  type SearchDriver,
  type SearchHit,
} from "@shaferllc/keel/core";

export class Post extends Model {
  static table = "posts";
  static searchable = ["title", "body"];
  declare id: number;
  declare title: string;
  declare body: string;
}

export function register() {
  registerSearchable(Post);
}

export async function querying() {
  const all = await search(Post, "edge runtime").get();
  const one = await search(Post, "edge").first();
  const ids = await search(Post, "edge").ids();
  const paged = await search(Post, "edge").limit(10).offset(20).get();
  return { all, one, ids, paged };
}

export function drivers() {
  setSearchDriver(new DatabaseSearchDriver());
  setSearchDriver(new MemorySearchDriver());
  return searchDriver();
}

export const migrations = [searchMigration()];

export async function backfill(): Promise<number> {
  return reindex(Post, { chunk: 1000 });
}

export function flatten(): string {
  return documentText({ title: "Hello", body: "World" });
}

/* ------------------------- writing your own driver ------------------------- */

interface MeiliIndex {
  addDocuments(docs: Record<string, unknown>[]): Promise<unknown>;
  deleteDocuments(ids: string[]): Promise<unknown>;
  deleteAllDocuments(): Promise<unknown>;
  search(
    query: string,
    options: { limit: number; offset: number },
  ): Promise<{ hits: { id: string | number; _rankingScore?: number }[] }>;
}
interface MeiliClient {
  index(name: string): MeiliIndex;
}

export const meiliDriver = (client: MeiliClient): SearchDriver => ({
  async index(index, documents) {
    await client.index(index).addDocuments(documents.map((d) => ({ id: d.id, ...d.fields })));
  },
  async delete(index, ids) {
    await client.index(index).deleteDocuments(ids);
  },
  async search(index, query, options = {}): Promise<SearchHit[]> {
    const res = await client.index(index).search(query, {
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
    return res.hits.map((h) => ({ id: String(h.id), score: h._rankingScore }));
  },
  async flush(index) {
    await client.index(index).deleteAllDocuments();
  },
});
