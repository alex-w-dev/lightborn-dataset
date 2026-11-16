import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { gameIconImgKind } from "@l-fight/dataset";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";

type SearchType =
  | "icons"
  | "monster-images"
  | "npc-images"
  | "locations"
  | "backgrounds"
  | "sfx"
  | "music";

type SearchHit = {
  type: SearchType;
  id: string;
  title: string;
  snippet: string;
  score: number;
};

const TYPE_OPTIONS: Array<{ type: SearchType; label: string }> = [
  { type: "icons", label: "items/skills" },
  { type: "monster-images", label: "monsters" },
  { type: "npc-images", label: "npcs" },
  { type: "locations", label: "locations" },
  { type: "backgrounds", label: "backgrounds" },
  { type: "sfx", label: "sfx" },
  { type: "music", label: "music" },
];

const TYPE_HREF: Record<SearchType, (id: string) => string> = {
  icons: (id) => {
    const kind = gameIconImgKind(id);
    return `/${kind}?q=${encodeURIComponent(id)}`;
  },
  "monster-images": (id) => `/monsters?q=${encodeURIComponent(id)}`,
  "npc-images": (id) => `/npcs?q=${encodeURIComponent(id)}`,
  locations: (id) => `/locations?q=${encodeURIComponent(id)}`,
  backgrounds: (id) => `/backgrounds?q=${encodeURIComponent(id)}`,
  sfx: (id) => `/sfx?q=${encodeURIComponent(id)}`,
  music: (id) => {
    const slash = id.indexOf("/");
    if (slash <= 0) return `/music?q=${encodeURIComponent(id)}`;
    const wave = id.slice(0, slash);
    const trackId = id.slice(slash + 1);
    return `/music?wave=${encodeURIComponent(wave)}&q=${encodeURIComponent(trackId)}`;
  },
};

const TYPE_LABEL = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.type, o.label]),
) as Record<SearchType, string>;

export default function AdminDatasetSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [types, setTypes] = useState<SearchType[]>(
    TYPE_OPTIONS.map((o) => o.type),
  );
  const [items, setItems] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [indexed, setIndexed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (query: string, selected: SearchType[]) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setTotal(0);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await adminApi.searchDataset({
        q: trimmed,
        types: selected,
        limit: 50,
      });
      setItems(data.items);
      setTotal(data.total);
      setIndexed(data.indexed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initialQ.trim()) return;
    void runSearch(initialQ, types);
    // только первичный заход по URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTypesSelected = types.length === TYPE_OPTIONS.length;

  const typeSummary = useMemo(() => {
    if (allTypesSelected) return "все типы";
    return types.map((t) => TYPE_LABEL[t]).join(", ");
  }, [allTypesSelected, types]);

  const toggleType = (type: SearchType) => {
    setTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((t) => t !== type);
        return next.length > 0 ? next : prev;
      }
      return [...prev, type];
    });
  };

  const onSubmit = () => {
    const trimmed = q.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
    void runSearch(trimmed, types);
  };

  const onReindex = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await adminApi.reindexDatasetSearch();
      setIndexed(data.count);
      if (q.trim()) await runSearch(q, types);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="h5">Поиск по dataset</Typography>
        <Button size="small" onClick={() => void onReindex()} disabled={busy}>
          Rebuild index
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          size="small"
          fullWidth
          label="Запрос"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="корона, m0001, sword…"
        />
        <Button
          variant="contained"
          startIcon={busy ? <CircularProgress size={16} /> : <SearchIcon />}
          onClick={onSubmit}
          disabled={busy || !q.trim()}
          sx={{ minWidth: 120 }}
        >
          Искать
        </Button>
      </Stack>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {TYPE_OPTIONS.map((opt) => (
          <Chip
            key={opt.type}
            label={opt.label}
            size="small"
            color={types.includes(opt.type) ? "primary" : "default"}
            variant={types.includes(opt.type) ? "filled" : "outlined"}
            onClick={() => toggleType(opt.type)}
          />
        ))}
      </Box>

      <Typography variant="body2" color="text.secondary">
        {indexed != null ? `Индекс: ${indexed} записей · ` : null}
        Типы: {typeSummary}
        {total > 0 ? ` · найдено ${total}` : null}
      </Typography>

      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}

      <Stack spacing={1}>
        {items.map((hit) => (
          <Paper key={`${hit.type}:${hit.id}`} sx={{ p: 1.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ sm: "flex-start" }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2">
                  {TYPE_LABEL[hit.type]} · {hit.id}
                  {hit.title && hit.title !== hit.id ? ` — ${hit.title}` : ""}
                </Typography>
                {hit.snippet ? (
                  <Typography variant="body2" color="text.secondary">
                    {hit.snippet}
                  </Typography>
                ) : null}
              </Box>
              <MuiLink
                component={Link}
                to={TYPE_HREF[hit.type](hit.id)}
                underline="hover"
                variant="body2"
                sx={{ whiteSpace: "nowrap" }}
              >
                Открыть
              </MuiLink>
            </Stack>
          </Paper>
        ))}
        {!busy && q.trim() && items.length === 0 && !error ? (
          <Typography variant="body2" color="text.secondary">
            Ничего не найдено
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}
