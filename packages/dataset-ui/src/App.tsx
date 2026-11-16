import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { assetUrl } from "@l-fight/shared-ui/config/game-icons-cdn";
import { CatalogPage } from "./pages/CatalogPage";
import { EntityImagesPage } from "./pages/EntityImagesPage";
import AdminMusic from "./admin/AdminMusic";
import AdminBackgrounds from "./admin/AdminBackgrounds";
import AdminGameIcons from "./admin/AdminGameIcons";
import AdminIconRetouch from "./admin/AdminIconRetouch";
import AdminSfx from "./admin/AdminSfx";
import AdminDatasetSearch from "./admin/AdminDatasetSearch";

/** Nav = S3 kinds: img/{kind} + music + sfx. */
const ASSET_NAV = [
  { to: "/search", label: "Поиск" },
  { to: "/items", label: "items" },
  { to: "/skills", label: "skills" },
  { to: "/ui", label: "ui" },
  { to: "/monsters", label: "monsters" },
  { to: "/npcs", label: "npcs" },
  { to: "/chars", label: "chars" },
  { to: "/backgrounds", label: "backgrounds" },
  { to: "/locations", label: "locations" },
  { to: "/music", label: "music" },
  { to: "/sfx", label: "sfx" },
  { to: "/icon-retouch", label: "icon-retouch" },
] as const;

export function App() {
  const { pathname } = useLocation();
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar sx={{ gap: 0.5, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ mr: 1 }}>
            Assets
          </Typography>
          {ASSET_NAV.map((item) => (
            <Button
              key={item.to}
              component={Link}
              to={item.to}
              color={pathname.startsWith(item.to) ? "primary" : "inherit"}
              size="small"
            >
              {item.label}
            </Button>
          ))}
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<AdminDatasetSearch />} />
          <Route path="/items" element={<AdminGameIcons kind="items" />} />
          <Route path="/skills" element={<AdminGameIcons kind="skills" />} />
          <Route path="/ui" element={<AdminGameIcons kind="ui" />} />
          <Route
            path="/monsters"
            element={
              <EntityImagesPage
                catalogKey="monster-images"
                title="monsters"
                entityType="monster"
              />
            }
          />
          <Route
            path="/npcs"
            element={
              <EntityImagesPage
                catalogKey="npc-images"
                title="npcs"
                entityType="npc"
              />
            }
          />
          <Route
            path="/chars"
            element={
              <CatalogPage
                catalogKey="avatar-images"
                title="chars"
                getImageUrl={(id) =>
                  assetUrl({
                    media: "img",
                    kind: "chars",
                    id,
                    size: 512,
                  })
                }
              />
            }
          />
          <Route path="/backgrounds" element={<AdminBackgrounds />} />
          <Route
            path="/locations"
            element={
              <CatalogPage
                catalogKey="location-images"
                title="locations"
                getImageUrl={(id) =>
                  assetUrl({
                    media: "img",
                    kind: "locations",
                    id,
                    size: 512,
                  })
                }
              />
            }
          />
          <Route path="/music" element={<AdminMusic />} />
          <Route path="/sfx" element={<AdminSfx />} />
          <Route path="/icon-retouch" element={<AdminIconRetouch />} />
          <Route path="/game-icons" element={<Navigate to="/items" replace />} />
          <Route
            path="/monster-images"
            element={<Navigate to="/monsters" replace />}
          />
          <Route path="/npc-images" element={<Navigate to="/npcs" replace />} />
          <Route
            path="/avatar-images"
            element={<Navigate to="/chars" replace />}
          />
        </Routes>
      </Container>
    </Box>
  );
}
