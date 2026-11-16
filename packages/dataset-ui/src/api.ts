import axios from "axios";

export const datasetApi = axios.create({
  baseURL: "/api",
});

export type AssetImageRow = { id: string; description: string };

export async function listCatalog(key: string): Promise<AssetImageRow[]> {
  const { data } = await datasetApi.get<AssetImageRow[]>(`/catalogs/${key}`);
  return data;
}

export async function upsertCatalogRow(
  key: string,
  row: AssetImageRow,
): Promise<AssetImageRow> {
  const { data } = await datasetApi.post<AssetImageRow>(`/catalogs/${key}`, row);
  return data;
}

export async function deleteCatalogRow(key: string, id: string): Promise<void> {
  await datasetApi.delete(`/catalogs/${key}/${encodeURIComponent(id)}`);
}

export async function listQuests(): Promise<unknown[]> {
  const { data } = await datasetApi.get<unknown[]>("/quests");
  return data;
}

export async function getQuest(id: number): Promise<unknown> {
  const { data } = await datasetApi.get(`/quests/${id}`);
  return data;
}

export async function saveQuest(
  id: number,
  quest: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await datasetApi.put(`/quests/${id}`, quest);
  return data;
}

export async function createQuest(
  quest: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await datasetApi.post("/quests", quest);
  return data;
}

export async function deleteQuest(id: number): Promise<void> {
  await datasetApi.delete(`/quests/${id}`);
}

export async function uploadEntityImage(
  type: "monster" | "npc" | "chars",
  id: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await datasetApi.post(`/icons/${type}/${encodeURIComponent(id)}/upload`, form);
}
