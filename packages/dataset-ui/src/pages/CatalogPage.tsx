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
  AssetImageRow,
  deleteCatalogRow,
  listCatalog,
  upsertCatalogRow,
} from "../api";

type Props = {
  catalogKey: string;
  title: string;
  /** URL превью по id записи каталога. */
  getImageUrl?: (id: string) => string;
};

export function CatalogPage({ catalogKey, title, getImageUrl }: Props) {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<AssetImageRow[]>([]);
  const [filter, setFilter] = useState(() => searchParams.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("q"),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    const data = await listCatalog(catalogKey);
    setRows(data);
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

  const selectedUrl =
    selected && getImageUrl ? getImageUrl(selected.id) : null;

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
                "&:hover": { bgcolor: "action.hover" },
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              {getImageUrl && (
                <Box
                  component="img"
                  src={getImageUrl(row.id)}
                  alt=""
                  loading="lazy"
                  sx={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                    flexShrink: 0,
                    bgcolor: "action.hover",
                  }}
                />
              )}
              {row.id}
            </Box>
          ))}
        </Paper>
        <Paper sx={{ flex: 2, p: 2 }}>
          {selected ? (
            <Stack spacing={2}>
              <Typography fontFamily="monospace">{selected.id}</Typography>
              {selectedUrl && (
                <Box
                  component="img"
                  src={selectedUrl}
                  alt={selected.id}
                  sx={{
                    width: 128,
                    height: 128,
                    objectFit: "contain",
                    bgcolor: "action.hover",
                  }}
                />
              )}
              <TextField
                label="description (prompt)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                multiline
                minRows={8}
                fullWidth
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void upsertCatalogRow(catalogKey, {
                      id: selected.id,
                      description: draft,
                    })
                      .then(reload)
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : String(err),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Сохранить
                </Button>
                <Button
                  color="error"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Удалить ${selected.id}?`)) return;
                    setBusy(true);
                    void deleteCatalogRow(catalogKey, selected.id)
                      .then(() => {
                        setSelectedId(null);
                        return reload();
                      })
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : String(err),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Удалить
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Typography color="text.secondary">Выберите запись</Typography>
          )}
        </Paper>
      </Stack>
    </Stack>
  );
}
