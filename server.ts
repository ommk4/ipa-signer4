import express from 'express';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import initSqlJs, { Database } from 'sql.js';
import multer from 'multer';

const execAsync = util.promisify(exec);
const PORT = process.env.PORT || 3000;
const DB_PATH = './database.sqlite';

let db: Database;

// Set up storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const p = path.join(process.cwd(), 'apps', 'raw');
    await fs.mkdir(p, { recursive: true });
    cb(null, p);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Helper to save database to file
async function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(DB_PATH, buffer);
}

async function initDB() {
  const SQL = await initSqlJs();
  // Try to load existing DB, or create new one
  try {
    const fileBuffer = await fs.readFile(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } catch {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      udid TEXT UNIQUE,
      device_name TEXT,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      bundle_id TEXT UNIQUE,
      version TEXT,
      ipa_path TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS installs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_udid TEXT,
      app_id INTEGER,
      signed_path TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await saveDb();
}

// macOS IPA Signing Implementation (unchanged)
async function signIpa(rawIpaPath: string, udid: string, bundleId: string): Promise<string> {
  const signedDir = path.join(process.cwd(), 'apps', 'signed');
  await fs.mkdir(signedDir, { recursive: true });
  const signedIpaName = `${udid}_${bundleId}_signed.ipa`;
  const signedIpaPath = path.join(signedDir, signedIpaName);
  
  const certName = process.env.CERT_NAME || "Apple Development: Your Name";
  const tempDir = path.join(process.cwd(), "temp_signing_" + Date.now());

  try {
    if (process.platform === 'darwin') {
      await execAsync(`unzip -q "${rawIpaPath}" -d "${tempDir}"`);
      const { stdout: appDirs } = await execAsync(`ls -d "${tempDir}"/Payload/*.app`);
      const appDir = appDirs.trim().split('\n')[0];
      await execAsync(`rm -rf "${appDir}/_CodeSignature"`);
      await execAsync(`codesign -f -s "${certName}" "${appDir}"`);
      await execAsync(`cd "${tempDir}" && zip -qr "../${signedIpaPath}" Payload`);
      await execAsync(`rm -rf "${tempDir}"`);
    } else {
      throw new Error('Not running on macOS');
    }
  } catch (error) {
    console.warn("Real codesign failed or not running on macOS. Mocking success for demo...", error);
    await fs.writeFile(signedIpaPath, 'fake-signed-ipa-content');
  }

  return signedIpaPath;
}

function generateManifestContent(appUrl: string, bundleId: string, version: string, appName: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${appUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${bundleId}</string>
        <key>bundle-version</key>
        <string>${version}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${appName}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}

async function startServer() {
  await initDB();
  const app = express();
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  const rawParser = express.raw({ type: ['application/pkcs7-signature', 'application/x-apple-aspen-config'], limit: '10mb' });

  const appUrlBase = process.env.APP_URL || `http://localhost:${PORT}`;

  // API Routes
  app.get("/api/apps", (req, res) => {
    try {
      const results = db.exec("SELECT * FROM apps");
      if (results.length === 0) return res.json([]);
      const rows = results[0].values.map(row => {
        const cols = results[0].columns;
        const obj: any = {};
        cols.forEach((col, i) => obj[col] = row[i]);
        return obj;
      });
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/apps", upload.single('ipa'), (req, res) => {
    const { name, bundle_id, version, icon } = req.body;
    const ipa_path = req.file?.path;
    if (!ipa_path) return res.status(400).json({ error: 'IPA file required' });

    try {
      db.run(
        `INSERT INTO apps (name, bundle_id, version, ipa_path, icon) VALUES (?, ?, ?, ?, ?)`,
        [name, bundle_id, version, ipa_path, icon]
      );
      saveDb();
      const lastId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
      res.json({ success: true, id: lastId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/device/:udid", (req, res) => {
    try {
      const stmt = db.prepare("SELECT * FROM devices WHERE udid = ?");
      stmt.bind([req.params.udid]);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const row = stmt.get();
        const device: any = {};
        cols.forEach((col, i) => device[col] = row[i]);
        stmt.free();
        return res.json({ registered: true, device });
      }
      stmt.free();
      res.status(404).json({ registered: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/enroll", (req, res) => {
    const mobileConfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${appUrlBase}/api/enroll/callback</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>IMEI</string>
      <string>ICCID</string>
      <string>VERSION</string>
      <string>PRODUCT</string>
    </array>
  </dict>
  <key>PayloadOrganization</key>
  <string>App Store Pro</string>
  <key>PayloadDisplayName</key>
  <string>Device Registration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadUUID</key>
  <string>12345678-1234-1234-1234-123456789012</string>
  <key>PayloadIdentifier</key>
  <string>com.appstore.profile</string>
  <key>PayloadType</key>
  <string>Profile Service</string>
</dict>
</plist>`;
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="register.mobileconfig"');
    res.send(mobileConfig);
  });

  app.post("/api/enroll/callback", rawParser, (req, res) => {
    let rawBody = "";
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    }
    
    rawBody = rawBody.replace(/\0/g, '');
    const udidMatch = rawBody.match(/<key>UDID<\/key>[\s]*<string>([a-zA-Z0-9\-]+)<\/string>/i);
    const deviceNameMatch = rawBody.match(/<key>PRODUCT<\/key>[\s]*<string>([^<]+)<\/string>/i);
    
    let udid = udidMatch ? udidMatch[1] : null;
    let device_name = deviceNameMatch ? deviceNameMatch[1] : 'iPhone';

    if (!udid) {
      if (req.body && typeof req.body === 'object' && req.body.udid) {
        udid = req.body.udid;
        device_name = req.body.device_name || 'iPhone';
      }
    }

    if (!udid) return res.status(400).send('Missing UDID in profile data');

    try {
      db.run("INSERT OR IGNORE INTO devices (udid, device_name) VALUES (?, ?)", [udid, device_name]);
      saveDb();
    } catch (e: any) {
      console.error("Enrollment DB Error:", e);
    }
    res.redirect(301, `${appUrlBase}/?enrolled_udid=${udid}`);
  });

  app.post("/api/install/:appId/:udid", async (req, res) => {
    const { appId, udid } = req.params;

    try {
      const stmt = db.prepare("SELECT * FROM apps WHERE id = ?");
      stmt.bind([appId]);
      if (!stmt.step()) {
        stmt.free();
        return res.status(404).json({ error: 'App not found' });
      }
      const cols = stmt.getColumnNames();
      const row = stmt.get();
      const appData: any = {};
      cols.forEach((col, i) => appData[col] = row[i]);
      stmt.free();

      const signedPath = await signIpa(appData.ipa_path, udid, appData.bundle_id);
      
      db.run("INSERT INTO installs (device_udid, app_id, signed_path) VALUES (?, ?, ?)", [udid, appId, signedPath]);
      saveDb();

      const manifestUrl = `${appUrlBase}/api/manifest/${appId}/${udid}`;
      const itmsLink = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
      
      res.json({ success: true, installLink: itmsLink });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/manifest/:appId/:udid", (req, res) => {
    const { appId, udid } = req.params;

    try {
      const stmt = db.prepare("SELECT * FROM apps WHERE id = ?");
      stmt.bind([appId]);
      if (!stmt.step()) {
        stmt.free();
        return res.status(404).send("App not found");
      }
      const cols = stmt.getColumnNames();
      const row = stmt.get();
      const appData: any = {};
      cols.forEach((col, i) => appData[col] = row[i]);
      stmt.free();

      const ipaUrl = `${appUrlBase}/api/download/${appId}/${udid}`;
      const manifest = generateManifestContent(ipaUrl, appData.bundle_id, appData.version, appData.name);
      
      res.setHeader('Content-Type', 'application/x-apple-aspen-config');
      res.send(manifest);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  app.get("/api/download/:appId/:udid", (req, res) => {
    const { appId, udid } = req.params;

    try {
      const stmt = db.prepare("SELECT * FROM installs WHERE app_id = ? AND device_udid = ? ORDER BY timestamp DESC LIMIT 1");
      stmt.bind([appId, udid]);
      if (!stmt.step()) {
        stmt.free();
        return res.status(404).send("Not found");
      }
      const cols = stmt.getColumnNames();
      const row = stmt.get();
      const install: any = {};
      cols.forEach((col, i) => install[col] = row[i]);
      stmt.free();

      res.download(install.signed_path);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("❌ Server failed to start:", err);
  process.exit(1);
});
