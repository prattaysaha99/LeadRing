import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.json());
const sessionMiddleware = cookieSession({
  name: "session",
  keys: [process.env.SESSION_SECRET || "leadring-secret"],
  maxAge: 24 * 60 * 60 * 1000,
  secure: true,
  sameSite: "none",
});

app.use(sessionMiddleware);

// Convert session middleware for socket.io
io.use((socket, next) => {
  const req = socket.request as any;
  const res = {} as any;
  sessionMiddleware(req, res, () => {
    next();
  });
});

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
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    (req as any).session.tokens = tokens;
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
  res.json({ authenticated: !!(req as any).session?.tokens });
});

app.post("/api/auth/logout", (req, res) => {
  (req as any).session = null;
  res.json({ success: true });
});

// Lead Monitoring Logic
const activeMonitors = new Map<string, NodeJS.Timeout>();

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

io.on("connection", (socket) => {
  const session = (socket.request as any).session;
  console.log("Client connected:", socket.id, "Authenticated:", !!session?.tokens);

  socket.on("start-monitoring", async ({ spreadsheetId }) => {
    if (!spreadsheetId || !session?.tokens) {
      console.log("Monitoring failed: missing ID or tokens");
      return;
    }

    console.log(`Starting monitor for ${socket.id} on ${spreadsheetId}`);
    
    let lastRowCount = -1;

    // Initial check to set baseline
    const initialRows = await checkLeads(session.tokens, spreadsheetId);
    if (initialRows === null) {
      socket.emit("monitoring-error", { message: "Failed to access spreadsheet. Check the ID and permissions." });
      return;
    }
    lastRowCount = initialRows.length;

    const interval = setInterval(async () => {
      const rows = await checkLeads(session.tokens, spreadsheetId);
      if (rows) {
        if (lastRowCount !== -1 && rows.length > lastRowCount) {
          const newLeads = rows.slice(lastRowCount);
          socket.emit("new-leads", { leads: newLeads, total: rows.length });
        }
        lastRowCount = rows.length;
      } else {
        socket.emit("monitoring-error", { message: "Lost connection to spreadsheet." });
        clearInterval(interval);
        activeMonitors.delete(socket.id);
      }
    }, 5000);

    activeMonitors.set(socket.id, interval);
  });

  socket.on("stop-monitoring", () => {
    const interval = activeMonitors.get(socket.id);
    if (interval) {
      clearInterval(interval);
      activeMonitors.delete(socket.id);
    }
  });

  socket.on("disconnect", () => {
    const interval = activeMonitors.get(socket.id);
    if (interval) {
      clearInterval(interval);
      activeMonitors.delete(socket.id);
    }
    console.log("Client disconnected:", socket.id);
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
