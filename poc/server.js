import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import agent1Router from "./routes/agent1.js";
import agent2Router from "./routes/agent2.js";
import "./data/subscribers.js"; // seeds mockDb on import

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in .env");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ─── Static frontend ──────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, "public")));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/agent1", agent1Router);
app.use("/api/agent2", agent2Router);

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
