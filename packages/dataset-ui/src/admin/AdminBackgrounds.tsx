import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { assetUrl } from "@l-fight/shared-ui/config/game-icons-cdn";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";

type BackgroundEntry = {
  id: string;
  file: string;
  name: string;
  description: string;
};

export default function AdminBackgrounds() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<BackgroundEntry[]>([]);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [s3Files, setS3Files] = useState<string[]>([]);
  const [filter, setFilter] = useState(() => searchParams.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("q"),
  );
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<{
    severity: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const rolesForId = useCallback(
    (id: string) =>
      Object.entries(roleMap)
        .filter(([, bgId]) => bgId === id)
        .map(([role]) => role),
    [roleMap],
  );

  const reload = useCallback(async () => {
    const [{ data: raw }, rolesRes, s3] = await Promise.all([
      adminApi.getDatasetRaw<BackgroundEntry[]>("backgrounds"),
      adminApi
        .getDatasetRaw<Record<string, string>>("background-roles")
        .catch(() => ({ data: {} as Record<string, string> })),
      adminApi.listBackgroundsS3().catch(() => ({ data: { files: [] } })),
    ]);
    setRows(Array.isArray(raw) ? raw : []);
    setRoleMap(
      rolesRes.data && typeof rolesRes.data === "object" ? rolesRes.data : {},
    );
    setS3Files(s3.data.files ?? []);
  }, []);

  useEffect(() => {
    void reload().catch((err: unknown) =>
      setBanner({
        severity: "error",
        text: err instanceof Error ? err.message : String(err),
      }),
    );
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const roles = rolesForId(r.id).join(" ");
      return (
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.file.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        roles.toLowerCase().includes(q)
      );
    });
  }, [filter, rows, rolesForId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const s3Set = useMemo(() => new Set(s3Files), [s3Files]);

  useEffect(() => {
    setDraftName(selected?.name ?? "");
    setDraftDesc(selected?.description ?? "");
  }, [selected?.id, selected?.name, selected?.description]);

  const saveSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setBanner(null);
    try {
      const nextRows = rows.map((r) =>
        r.id === selected.id
          ? {
              id: r.id,
              file: r.file,
              name: draftName.trim() || r.name,
              description: draftDesc,
            }
          : {
              id: r.id,
              file: r.file,
              name: r.name,
              description: r.description,
            },
      );

      await adminApi.putDatasetRaw("backgrounds", nextRows);
      setRows(nextRows);
      setBanner({
        severity: "success",
        text: "Фон сохранён",
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message ||
        (err instanceof Error ? err.message : String(err));
      setBanner({
        severity: "error",
        text: Array.isArray(message) ? message.join(", ") : String(message),
      });
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File | undefined) => {
    if (!selected || !file) return;
    setUploading(true);
    setBanner(null);
    try {
      const { data } = await adminApi.uploadBackground(selected.id, file);
      setBanner({
        severity: "success",
        text: `Загружено в S3: ${data.key}`,
      });
      await reload();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message ||
        (err instanceof Error ? err.message : String(err));
      setBanner({
        severity: "error",
        text: Array.isArray(message) ? message.join(", ") : String(message),
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Фоны</Typography>
      <Typography variant="body2" color="text.secondary">
        Ассет-каталог backgrounds.json → S3 img/backgrounds/{"{id}"}/. Roles
        Lightborn правятся в GM (background-roles).
      </Typography>
      {banner ? (
        <Alert severity={banner.severity} onClose={() => setBanner(null)}>
          {banner.text}
        </Alert>
      ) : null}
      <TextField
        size="small"
        label="Фильтр"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Paper sx={{ flex: 1, maxHeight: 560, overflow: "auto", p: 1 }}>
          {filtered.map((row) => {
            const onS3 = s3Set.has(row.id);
            return (
              <Box
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  cursor: "pointer",
                  bgcolor:
                    row.id === selectedId ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box
                  component="img"
                  src={assetUrl({
                    media: "img",
                    kind: "backgrounds",
                    id: row.id,
                    size: 512,
                  })}
                  alt=""
                  sx={{
                    width: 56,
                    height: 36,
                    objectFit: "cover",
                    borderRadius: 0.5,
                    bgcolor: "grey.900",
                  }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap fontWeight={600}>
                    {row.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: "monospace" }}
                  >
                    {row.id} · {row.file}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={onS3 ? "S3" : "нет в S3"}
                  color={onS3 ? "success" : "warning"}
                  variant="outlined"
                />
              </Box>
            );
          })}
        </Paper>

        <Paper sx={{ flex: 1.2, p: 2 }}>
          {!selected ? (
            <Typography color="text.secondary">Выбери фон слева</Typography>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="h6">{selected.id}</Typography>
              <Box
                component="img"
                src={assetUrl({
                  media: "img",
                  kind: "backgrounds",
                  id: selected.id,
                  size: 512,
                })}
                alt={selected.name}
                sx={{
                  width: "100%",
                  maxHeight: 240,
                  objectFit: "cover",
                  borderRadius: 1,
                  bgcolor: "grey.900",
                }}
              />
              <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                img/backgrounds/{selected.id}/512.jpg
              </Typography>
              <TextField
                size="small"
                label="Название"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
              {rolesForId(selected.id).length > 0 ? (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {rolesForId(selected.id).map((role) => (
                    <Chip key={role} size="small" label={role} variant="outlined" />
                  ))}
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Roles Lightborn — только в GM (background-roles)
                </Typography>
              )}
              <TextField
                size="small"
                label="Описание / промпт"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                multiline
                minRows={3}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => void saveSelected()}
                >
                  {busy ? <CircularProgress size={18} /> : "Сохранить JSON"}
                </Button>
                <Button
                  variant="outlined"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? <CircularProgress size={18} /> : "Залить в S3"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  hidden
                  onChange={(e) => void onUpload(e.target.files?.[0])}
                />
              </Stack>
            </Stack>
          )}
        </Paper>
      </Stack>
    </Stack>
  );
}
