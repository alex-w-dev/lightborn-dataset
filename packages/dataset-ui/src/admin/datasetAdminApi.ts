import axios from "axios";

/** Тонкий клиент dataset-api без Lightborn. */
const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (config.data instanceof FormData && config.headers) {
    delete config.headers["Content-Type"];
  }
  return config;
});

export const datasetAdminApi = {
  getDatasetRaw: <T = unknown>(resource: string) =>
    api.get<T>(`/admin/${resource}/raw`),
  putDatasetRaw: <T = unknown>(resource: string, body: unknown) =>
    api.put<T>(`/admin/${resource}/raw`, body),
  searchDataset: (params: {
    q: string;
    limit?: number;
    kinds?: string[];
  }) => api.get("/admin/search", { params }),
  reindexDatasetSearch: () => api.post("/admin/search/reindex"),
  getGameIconsRaw: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/raw"),
  getGameIconsPendingSync: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/pending-sync"),
  getGameIconsNeedLocalUpdate: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/need-local-update"),
  fromClipboardGameIcon: (params: { icon: string; imageBase64: string }) =>
    api.post<{
      source: "clipboard";
      image512Base64: string;
      image64Base64: string;
    }>("/admin/game-icons/from-clipboard", params),
  saveGameIconRaw: (params: { icon: string; imageBase64: string }) =>
    api.post("/admin/game-icons/raw", params),
  applyGameIconRaw: (icon: string) =>
    api.post<{
      source: "clipboard";
      image512Base64: string;
      image64Base64: string;
    }>("/admin/game-icons/raw/apply", { icon }),
  restoreGameIconFromS3: (icon: string) =>
    api.post<{
      ok: true;
      icon: string;
      image512Base64: string;
      image64Base64: string;
    }>("/admin/game-icons/restore-from-s3", { icon }),
  transformGameIconLocal: (params: {
    icon: string;
    op: "flipHorizontal" | "rotate180";
  }) =>
    api.post<{
      ok: true;
      icon: string;
      op: "flipHorizontal" | "rotate180";
      transformedRaw: boolean;
      transformed512: boolean;
      image512Base64: string | null;
      image64Base64: string | null;
    }>("/admin/game-icons/transform", params),
  deleteGameIconRaw: (icon: string) =>
    api.delete(`/admin/game-icons/raw/${encodeURIComponent(icon)}`),
  clearGameIconPendingSync: (icon: string) =>
    api.delete<{
      ok: true;
      icon: string;
      icons: string[];
      needLocalUpdateIcons: string[];
      deletedLocal: boolean;
    }>(`/admin/game-icons/pending-sync/${encodeURIComponent(icon)}`),
  applyGameIcon: (params: { icon: string; image512Base64?: string }) =>
    api.post<{ ok: true; keys: string[]; urls: string[] }>(
      "/admin/game-icons/apply",
      params,
    ),
  getGameIconS3Source: (icon: string) =>
    api.get<{ icon: string; imageBase64: string; mime: "image/jpeg" }>(
      `/admin/game-icons/s3-source/${encodeURIComponent(icon)}`,
    ),
  getGameIconRetouchRaw: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/retouch/raw"),
  saveGameIconRetouchRaw: (params: { icon: string; imageBase64: string }) =>
    api.post("/admin/game-icons/retouch/raw", params),
  applyGameIconRetouchRaw: (icon: string) =>
    api.post("/admin/game-icons/retouch/raw/apply", { icon }),
  fromRetouchClipboardGameIcon: (params: {
    icon: string;
    imageBase64: string;
  }) => api.post("/admin/game-icons/retouch/from-clipboard", params),
  transformGameIconRetouch: (params: {
    icon: string;
    op: "flipHorizontal" | "rotate180";
  }) => api.post("/admin/game-icons/retouch/transform", params),
  applyGameIconRetouch: (params: { icon: string }) =>
    api.post("/admin/game-icons/retouch/apply", params),
  clearGameIconRetouchPendingSync: (icon: string) =>
    api.delete(
      `/admin/game-icons/retouch/pending-sync/${encodeURIComponent(icon)}`,
    ),
  getGameIconRetouchPendingSync: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/retouch/pending-sync"),
  getGameIconRetouchNeedLocalUpdate: () =>
    api.get<{ icons: string[] }>(
      "/admin/game-icons/retouch/need-local-update",
    ),
  getGameIconRetouchUpdatedLocally: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/retouch/updated-locally"),
  getGameIconRetouchUpdatedInS3: () =>
    api.get<{ icons: string[] }>("/admin/game-icons/retouch/updated-in-s3"),
  getMusicWave: (wave: string) =>
    api.get(`/admin/music/${encodeURIComponent(wave)}`),
  uploadMusic: (wave: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(
      `/admin/music/${encodeURIComponent(wave)}/upload`,
      form,
    );
  },
  deleteMusic: (wave: string, id: string) =>
    api.delete(
      `/admin/music/${encodeURIComponent(wave)}/${encodeURIComponent(id)}`,
    ),
  getSfxCatalog: () => api.get("/admin/sfx/catalog"),
  uploadSfxSlices: (
    baseId: string,
    file: File,
    body: Record<string, unknown>,
  ) => {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(body)) {
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    return api.post(`/admin/sfx/${encodeURIComponent(baseId)}/upload-slices`, form);
  },
  deleteSfxVariant: (id: string, variant: number) =>
    api.delete(
      `/admin/sfx/${encodeURIComponent(id)}/variants/${variant}`,
    ),
  duplicateLastSfxVariant: (id: string) =>
    api.post(`/admin/sfx/${encodeURIComponent(id)}/variants`),
  listBackgroundsS3: () => api.get<{ files: string[] }>("/admin/backgrounds/s3"),
  uploadBackground: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/admin/backgrounds/${encodeURIComponent(id)}`, form);
  },
};
