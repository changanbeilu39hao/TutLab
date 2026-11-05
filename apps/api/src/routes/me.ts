import { Hono } from "hono";
import { currentAuth, type AppEnv } from "../lib/auth";

export const meRoute = new Hono<AppEnv>().get("/", (c) => {
  const { profile } = currentAuth(c);
  return c.json({
    id: profile.id,
    role: profile.role,
    display_name: profile.display_name,
    campus: profile.campus,
  });
});
