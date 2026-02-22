import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import { google } from "googleapis";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import dotenv from "dotenv";
import path from "path";
import http from "http";

dotenv.config();

const app = new Hono();
const PORT = 3000;

// Google OAuth Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// Auth Routes
app.get("/api/auth/url", (c) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    prompt: "consent",
  });
  return c.json({ url });
});

app.get("/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("Missing code", 400);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Store tokens in a cookie (simplified for Cloudflare compatibility)
    setCookie(c, "leadring_tokens", JSON.stringify(tokens), {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "None",
      maxAge: 60 * 60 * 24, // 1 day
    });

    return c.html(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    return c.text("Authentication failed", 500);
  }
});

app.get("/api/auth/status", (c) => {
  const tokens = getCookie(c, "leadring_tokens");
  return c.json({ authenticated: !!tokens });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, "leadring_tokens");
  return c.json({ success: true });
});

// Lead Monitoring Logic
async function checkLeads(tokens: any, spreadsheetId: string) {
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "A:Z",
    });
    return response.data.values || [];
  } catch (error) {
    console.error("Error checking leads:", error);
    return null;
  }
}

// Start Node Server
const server = serve({
  fetch: app.fetch,
  port: PORT,
});

// Setup WebSockets (Node.js version)
const wss = new WebSocketServer({ server: server as any });

wss.on("connection", (ws) => {
  console.log("Client connected to WebSocket");
  let monitorInterval: NodeJS.Timeout | null = null;

  ws.on("message", async (message) => {
    const data = JSON.parse(message.toString());

    if (data.type === "start-monitoring") {
      const { spreadsheetId, tokens } = data;
      if (!spreadsheetId || !tokens) return;

      console.log(`Monitoring started for ${spreadsheetId}`);
      let lastRowCount = -1;

      const initialRows = await checkLeads(tokens, spreadsheetId);
      if (initialRows === null) {
        ws.send(JSON.stringify({ type: "error", message: "Failed to access spreadsheet." }));
        return;
      }
      lastRowCount = initialRows.length;

      monitorInterval = setInterval(async () => {
        const rows = await checkLeads(tokens, spreadsheetId);
        if (rows) {
          if (lastRowCount !== -1 && rows.length > lastRowCount) {
            const newLeads = rows.slice(lastRowCount);
            ws.send(JSON.stringify({ type: "new-leads", leads: newLeads }));
          }
          lastRowCount = rows.length;
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Lost connection to spreadsheet." }));
          if (monitorInterval) clearInterval(monitorInterval);
        }
      }, 5000);
    }

    if (data.type === "stop-monitoring") {
      if (monitorInterval) clearInterval(monitorInterval);
    }
  });

  ws.on("close", () => {
    if (monitorInterval) clearInterval(monitorInterval);
    console.log("Client disconnected");
  });
});

// Vite Integration for Dev
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Use Hono's middleware to wrap Vite
    app.use("*", async (c, next) => {
      return new Promise((resolve) => {
        vite.middlewares(c.req.raw as any, c.res as any, () => {
          resolve(next());
        });
      });
    });
  } else {
    app.use("/assets/*", serveStatic({ root: "./dist" }));
    app.get("*", serveStatic({ path: "./dist/index.html" }));
  }
}

setupVite();

console.log(`Server running on http://localhost:${PORT}`);
