import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDomainRoutes } from "./routes/domain.js";
import { lastKnownSnapshot, refreshFromEtrade } from "./agents/market-data/index.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.webOrigin, credentials: true });
await registerAuthRoutes(app);
await registerDomainRoutes(app);

app.get("/api/health", async () => ({ ok: true }));

app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  reply.status(status).send({ message: err.message });
});

if (config.mockMode && !lastKnownSnapshot()) {
  await refreshFromEtrade();
}

try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
