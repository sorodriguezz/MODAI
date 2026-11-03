import type { CategoryRecord } from "../types.js";
import { DirectoryApi } from "./directory.js";

export class CategoriesApi extends DirectoryApi {
  async categories(): Promise<CategoryRecord[]> {
    return (await this.request<{ categories: CategoryRecord[] }>("/api/v1/categories")).categories;
  }

  async createCategory(input: { name: string; description?: string }): Promise<CategoryRecord> {
    return (
      await this.request<{ category: CategoryRecord }>("/api/v1/categories", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).category;
  }

  async updateCategory(name: string, input: { description: string }): Promise<CategoryRecord> {
    return (
      await this.request<{ category: CategoryRecord }>(`/api/v1/categories/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).category;
  }

  async deleteCategory(name: string): Promise<void> {
    await this.request(`/api/v1/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
}
