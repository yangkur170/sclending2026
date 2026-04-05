const express = require('express');
const multer  = require('multer');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: 'sc-lending-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ── Multer (image uploads) ───────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename:    (req, file, cb) => {
    const target = req.body.target || 'upload';
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, target + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Auth guard ───────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized — please login' });
};

// ── Helper ───────────────────────────────────────────────────
const getConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const saveConfig = (data) => fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(data, null, 2));

// ── Routes ───────────────────────────────────────────────────

// Public: get config (for frontend)
app.get('/api/config', (req, res) => {
  try {
    const config = getConfig();
    const { adminPassword, ...safe } = config; // never expose password
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Config not found' });
  }
});

// Auth: login
app.post('/api/login', (req, res) => {
  const config = getConfig();
  if (req.body.password === config.adminPassword) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// Auth: logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Auth: check session
app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// Admin: save config
app.post('/api/config', requireAuth, (req, res) => {
  try {
    const current = getConfig();
    // Merge — keep adminPassword safe
    const updated = { ...current, ...req.body, adminPassword: current.adminPassword };
    saveConfig(updated);
    res.json({ success: true, message: 'Settings saved successfully!' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Admin: change password
app.post('/api/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const config = getConfig();
  config.adminPassword = newPassword;
  saveConfig(config);
  res.json({ success: true, message: 'Password changed!' });
});

// Admin: upload image
app.post('/api/upload', requireAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    const target = req.body.target; // logo | building1 | building2
    const ext    = path.extname(req.file.originalname).toLowerCase();
    const newName = target + ext;
    const oldPath = req.file.path;
    const newPath = path.join(__dirname, newName);

    // Rename to correct target name
    if (oldPath !== newPath) {
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
      fs.renameSync(oldPath, newPath);
    }

    // Update config
    const config = getConfig();
    config[target] = newName;
    saveConfig(config);

    res.json({ success: true, filename: newName, url: '/' + newName });
  });
});

// Serve admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ✅  SC Lending Corp. server started!');
  console.log('');
  console.log('  🌐  Website  →  http://localhost:' + PORT);
  console.log('  🔧  Admin    →  http://localhost:' + PORT + '/admin');
  console.log('  🔑  Password →  sclending2024');
  console.log('');
});
