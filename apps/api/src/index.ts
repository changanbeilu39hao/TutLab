import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware, type AppEnv } from "./lib/auth";
import { ApiError } from "./lib/errors";
import { meRoute } from "./routes/me";
import { todayRoute } from "./routes/today";
import { sessionsRoute } from "./routes/sessions";
import { concernsRoute } from "./routes/concerns";
import { impersonateRoute } from "./routes/impersonate";
import { studentsRoute } from "./routes/students";
import { scheduleRoute } from "./routes/schedule";

export const app = new Hono<AppEnv>();

app.use("/api/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "x-act-as"],
  exposeHeaders: ["x-impersonated-by"],
}));
app.use("/api/*", authMiddleware);

app.route("/api/me", meRoute);
app.route("/api/today", todayRoute);
app.route("/api/sessions", sessionsRoute);
app.route("/api/concerns", concernsRoute);
app.route("/api/impersonate", impersonateRoute);
app.route("/api/students", studentsRoute);
app.route("/api/schedule", scheduleRoute);

app.notFound((c) => c.json(new ApiError("NOT_FOUND", 404).body(), 404));
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json(error.body(), error.status);
  console.error(error);
  return c.json(new ApiError("LLM_UNAVAILABLE", 500, "服务暂时不可用").body(), 500);
});

export default app;
