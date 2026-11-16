import {
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getMonsterIconUrl,
  getMonsterPreviewUrl,
  getNpcIconUrl,
  getNpcPreviewUrl,
} from "@l-fight/shared-ui/utils/entityIconUrls";
import {
  AssetImageRow,
  listCatalog,
  uploadEntityImage,
  upsertCatalogRow,
} from "../api";

type Props = {
  catalogKey: string;
  title: string;
  entityType: "monster" | "npc";
};

export function EntityImagesPage({ catalogKey, title, entityType }: Props) {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<AssetImageRow[]>([]);
  const [filter, setFilter] = useState(() => searchParams.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("q"),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);

  const thumbUrl = useCallback(
    (id: string) =>
      entityType === "monster"
        ? getMonsterIconUrl(id, bust || undefined)
        : getNpcIconUrl(id, bust || undefined),
    [entityType, bust],
  );

  const detailUrl = useCallback(
    (id: string) =>
      entityType === "monster"
        ? getMonsterPreviewUrl(id, bust || undefined)
        : getNpcPreviewUrl(id, bust || undefined),
    [entityType, bust],
  );

  const reload = useCallback(async () => {
    setRows(await listCatalog(catalogKey));
  }, [catalogKey]);

  useEffect(() => {
    void reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [filter, rows]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    setDraft(selected?.description ?? "");
  }, [selected?.id, selected?.description]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{title}</Typography>
      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}
      <TextField
        size="small"
        label="Фильтр"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Paper sx={{ flex: 1, maxHeight: 520, overflow: "auto", p: 1 }}>
          {filtered.map((row) => (
            <Box
              key={row.id}
              onClick={() => setSelectedId(row.id)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1,
                py: 0.5,
                cursor: "pointer",
                bgcolor:
                  row.id === selectedId ? "action.selected" : "transparent",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              <Box
                component="img"
                src={thumbUrl(row.id)}
                alt=""
                loading="lazy"
                sx={{
                  width: 40,
                  height: 40,
                  objectFit: "cover",
                  flexShrink: 0,
                  bgcolor: "action.hover",
                }}
              />
              {row.id}
            </Box>
          ))}
        </Paper>
        <Paper sx={{ flex: 2, p: 2 }}>
          {selected ? (
            <Stack spacing={2}>
              <Typography fontFamily="monospace">{selected.id}</Typography>
              <Box
                component="img"
                src={detailUrl(selected.id)}
                alt={selected.id}
                sx={{ width: 196, height: 196, objectFit: "cover" }}
              />
              <Button variant="outlined" component="label">
                Upload JPEG/PNG
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void uploadEntityImage(entityType, selected.id, file)
                      .then(() => setBust(Date.now()))
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : String(err),
                        ),
                      );
                  }}
                />
              </Button>
              <TextField
                label="description (prompt)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                multiline
                minRows={6}
                fullWidth
              />
              <Button
                variant="contained"
                onClick={() => {
                  void upsertCatalogRow(catalogKey, {
                    id: selected.id,
                    description: draft,
                  })
                    .then(reload)
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    );
                }}
              >
                Сохранить description
              </Button>
            </Stack>
          ) : (
            <Typography color="text.secondary">Выберите запись</Typography>
          )}
        </Paper>
      </Stack>
    </Stack>
  );
}
