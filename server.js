import express from 'express';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import sqlite3 from 'sqlite3';
import multer from 'multer';

const execAsync = util.promisify(exec);
const db = new sqlite3.Database('./database.sqlite');
const PORT = 3000;

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

async function initDB() {
  return new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        udid TEXT UNIQUE,
        device_name TEXT,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        bundle_id TEXT UNIQUE,
        version TEXT,
        ipa_path TEXT,
        icon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS installs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_udid TEXT,
        app_id INTEGER,
        signed_path TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// macOS IPA Signing Implementation
async function signIpa(rawIpaPath: string, udid: string, bundleId: string): Promise<string> {
  const signedDir = path.join(process.cwd(), 'apps', 'signed');
  await fs.mkdir(signedDir, { recursive: true });
  const signedIpaName = `${udid}_${bundleId}_signed.ipa`;
  const signedIpaPath = path.join(signedDir, signedIpaName);
  
  // Example path for the user's generic certs (they would configure this)
  const certName = process.env.CERT_NAME || "Apple Development: Your Name";
  const tempDir = path.join(process.cwd(), "temp_signing_" + Date.now());

  try {
    if (process.platform === 'darwin') {
      // 1. Unzip
      await execAsync(`unzip -q "${rawIpaPath}" -d "${tempDir}"`);
      // 2. Identify app directory
      const { stdout: appDirs } = await execAsync(`ls -d "${tempDir}"/Payload/*.app`);
      const appDir = appDirs.trim().split('\n')[0];
      // 3. Remove old signature
      await execAsync(`rm -rf "${appDir}/_CodeSignature"`);
      // 4. In a real scenario, you copy the generated device profile here:
      // await execAsync(`cp "profiles/${udid}.mobileprovision" "${appDir}/embedded.mobileprovision"`);
      // 5. Sign
      await execAsync(`codesign -f -s "${certName}" "${appDir}"`);
      // 6. Zip back
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
  
  // For parsing application/json
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Specific raw parser for Apple profile PKCS7 signature (convert immediately to string)
  const rawParser = express.raw({ type: ['application/pkcs7-signature', 'application/x-apple-aspen-config'], limit: '10mb' });

  const appUrlBase = process.env.APP_URL || `http://localhost:${PORT}`;

  // API Routes
  app.get("/api/apps", (req, res) => {
    db.all("SELECT * FROM apps", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post("/api/admin/apps", upload.single('ipa'), (req, res) => {
    const { name, bundle_id, version, icon } = req.body;
    const ipa_path = req.file?.path;
    if (!ipa_path) return res.status(400).json({ error: 'IPA file required' });

    db.run(
      `INSERT INTO apps (name, bundle_id, version, ipa_path, icon) VALUES (?, ?, ?, ?, ?)`,
      [name, bundle_id, version, ipa_path, icon],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      }
    );
  });

  // Check if device is registered
  app.get("/api/device/:udid", (req, res) => {
    db.get("SELECT * FROM devices WHERE udid = ?", [req.params.udid], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ registered: false });
      res.json({ registered: true, device: row });
    });
  });

  // Mock enrollment profile download
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

  // Handle enrollment callback (in reality this is XML body sent by iOS settings)
  app.post("/api/enroll/callback", rawParser, (req, res) => {
    let rawBody = "";
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
      // Some pkcs7 signatures might be binary or contain zero-width spaces depending on encoding, but ascii/utf8 usually reveals the XML content inside.
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    }
    
    // The iPhone sends a PKCS7 signed plist. The text parser reads it as a string.
    // We can extract the UDID using regex from the embedded plist string.
    // iOS might send 16-bit strings or add null bytes, removing null bytes first helps
    rawBody = rawBody.replace(/\0/g, '');
    const udidMatch = rawBody.match(/<key>UDID<\/key>[\s]*<string>([a-zA-Z0-9\-]+)<\/string>/i);
    const deviceNameMatch = rawBody.match(/<key>PRODUCT<\/key>[\s]*<string>([^<]+)<\/string>/i);
    
    let udid = udidMatch ? udidMatch[1] : null;
    let device_name = deviceNameMatch ? deviceNameMatch[1] : 'iPhone';

    if (!udid) {
      // Fallback if sent as standard JSON (for testing)
      if (req.body && typeof req.body === 'object' && req.body.udid) {
        udid = req.body.udid;
        device_name = req.body.device_name || 'iPhone';
      }
    }

    if (!udid) return res.status(400).send('Missing UDID in profile data');

    db.run(`INSERT OR IGNORE INTO devices (udid, device_name) VALUES (?, ?)`, [udid, device_name], (err) => {
      if (err) console.error("Enrollment DB Error:", err);
      // Apple Profile Service requires a Redirect (301) to return the user to Safari
      res.redirect(301, `${appUrlBase}/?enrolled_udid=${udid}`);
    });
  });

  // Request App Installation directly
  app.post("/api/install/:appId/:udid", async (req, res) => {
    const { appId, udid } = req.params;

    // 1. Get App details
    db.get("SELECT * FROM apps WHERE id = ?", [appId], async (err, appData: any) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!appData) return res.status(404).json({ error: 'App not found' });

      // 2. Sign IPA
      try {
        const signedPath = await signIpa(appData.ipa_path, udid, appData.bundle_id);
        
        // Ensure install recorded
        db.run("INSERT INTO installs (device_udid, app_id, signed_path) VALUES (?, ?, ?)", [udid, appId, signedPath]);

        // 3. Return manifest URL
        const manifestUrl = `${appUrlBase}/api/manifest/${appId}/${udid}`;
        const itmsLink = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
        
        res.json({ success: true, installLink: itmsLink });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });
  });

  // Serve Manifest.plist
  app.get("/api/manifest/:appId/:udid", (req, res) => {
    const { appId, udid } = req.params;
    db.get("SELECT * FROM apps WHERE id = ?", [appId], (err, appData: any) => {
      if (err || !appData) return res.status(404).send("App not found");
      
      const ipaUrl = `${appUrlBase}/api/download/${appId}/${udid}`;
      const manifest = generateManifestContent(ipaUrl, appData.bundle_id, appData.version, appData.name);
      
      res.setHeader('Content-Type', 'application/x-apple-aspen-config'); // plist type
      res.send(manifest);
    });
  });

  // Serve signed IPA
  app.get("/api/download/:appId/:udid", (req, res) => {
    const { appId, udid } = req.params;
    db.get("SELECT * FROM installs WHERE app_id = ? AND device_udid = ? ORDER BY timestamp DESC LIMIT 1", [appId, udid], (err, row: any) => {
      if (err || !row) return res.status(404).send("Not found");
      res.download(row.signed_path);
    });
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

startServer();
