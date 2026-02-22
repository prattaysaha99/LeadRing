import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import cookie from "cookie";
import dotenv from "dotenv";
import path from "path";
import http from "http";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());

// Google OAuth Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// Auth Routes
app.get("/api/auth/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    prompt: "consent",
  });
  res.json({ url });
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    res.cookie("leadring_tokens", JSON.stringify(tokens), {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    });

    res.send(`
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
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  const tokens = req.cookies.leadring_tokens;
  res.json({ authenticated: !!tokens });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("leadring_tokens");
  res.json({ success: true });
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

// Setup WebSockets
wss.on("connection", (ws, req) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const sessionTokens = cookies.leadring_tokens ? JSON.parse(cookies.leadring_tokens) : null;
  
  console.log("Client connected to WebSocket. Tokens available:", !!sessionTokens);
  let monitorInterval: NodeJS.Timeout | null = null;

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === "start-monitoring") {
        const { spreadsheetId } = data;
        
        if (!sessionTokens) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required. Please log in again." }));
          return;
        }

        console.log(`Monitoring started for ${spreadsheetId}`);
        let lastRowCount = -1;

        const initialRows = await checkLeads(sessionTokens, spreadsheetId);
        if (initialRows === null) {
          ws.send(JSON.stringify({ type: "error", message: "Failed to access spreadsheet. Ensure you have permissions." }));
          return;
        }
        lastRowCount = initialRows.length;

        monitorInterval = setInterval(async () => {
          const rows = await checkLeads(sessionTokens, spreadsheetId);
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
    } catch (e) {
      console.error("WS Message Error", e);
    }
  });

  ws.on("close", () => {
    if (monitorInterval) clearInterval(monitorInterval);
    console.log("Client disconnected");
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
