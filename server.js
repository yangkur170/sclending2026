const express  = require('express');
const multer   = require('multer');
const session  = require('express-session');
const fs       = require('fs');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Detect environment ──────────────────────────────────────
// Only use PostgreSQL if DATABASE_URL looks like a real connection string
const dbUrl = process.env.DATABASE_URL || '';
const isProd = dbUrl.startsWith('postgres') && !dbUrl.includes('@host:');

// ── PostgreSQL (production) ─────────────────────────────────
let pool;
if (isProd) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

// ── Cloudinary (production) ─────────────────────────────────
let cloudinary, CloudinaryStorage;
if (isProd) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  CloudinaryStorage = require('multer-storage-cloudinary').CloudinaryStorage;
}

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sc-lending-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Multer storage ──────────────────────────────────────────
let storage;
if (isProd) {
  storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder:         'sclending',
      public_id:      req.body.target || 'upload',
      overwrite:      true,
      resource_type:  'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif']
    })
  });
} else {
  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, __dirname),
    filename:    (req, file, cb) => {
      const target = req.body.target || 'upload';
      const ext    = path.extname(file.originalname).toLowerCase();
      cb(null, target + ext);
    }
  });
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Auth guard ──────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized — please login' });
};

// ── Default config ──────────────────────────────────────────
const defaultConfig = {
  companyName:    'SC LENDING CORP.',
  tagline:        'Since 1997',
  applyLink:      'https://primelendph.finance/choose/',
  logo:           'logo.png',
  building1:      'building1.jpg',
  building2:      'building2.jpg',
  phone:          '+63 (0) 000 000 0000',
  email:          'info@sclendingcorp.com',
  address:        'Unit 2308, Jollibee Plaza, Emerald Avenue, Pasig City, 1605, Philippines',
  officeHours:    'Monday \u2013 Friday: 8:00 AM \u2013 5:00 PM | Saturday: 8:00 AM \u2013 12:00 PM',
  heroTitle:      'Your Trusted Financial Partner in the Philippines',
  heroSubtitle:   'SC Lending Corp. has been empowering Filipinos with accessible, transparent, and reliable loan solutions for over 27 years. Serving individuals and businesses with integrity since 1997.',
  aboutTitle:     'Building Financial Trust Since 1997',
  aboutText:      'SC Lending Corp. is a duly registered lending company under the Securities and Exchange Commission of the Philippines. With over two decades of dedicated service, we are committed to providing fair, transparent, and professional financial solutions to Filipinos.',
  aboutText2:     'Our office is strategically located at Jollibee Plaza, Emerald Avenue, Pasig City \u2014 at the heart of Metro Manila\u2019s premier business district, making us accessible and easy to reach.',
  registrationNo: 'A199705228',
  licenseNo:      '437',
  regDate:        'March 26, 1997',
  mapsLink:       'https://www.google.com/maps/place/SC+Lending+Corporation/@14.5877605,121.0601131,17.97z/data=!3m1!4b1!4m6!3m5!1s0x3397c817450c6a75:0x1fb0d614a3d3756b!8m2!3d14.587758!4d121.061353!16s%2Fg%2F11bzv_0mkt?entry=ttu',
  yearsInOperation: '27+',
  adminPassword:  'sclending2024'
};

// ── Config helpers ──────────────────────────────────────────
const getConfig = async () => {
  if (isProd) {
    const result = await pool.query('SELECT data FROM config WHERE id = 1');
    return result.rows[0]?.data || defaultConfig;
  }
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
};

const saveConfig = async (data) => {
  if (isProd) {
    await pool.query('UPDATE config SET data = $1 WHERE id = 1', [JSON.stringify(data)]);
  } else {
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(data, null, 2));
  }
};

// ── DB init ─────────────────────────────────────────────────
const initDB = async () => {
  if (!isProd) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      id   INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
  const result = await pool.query('SELECT id FROM config WHERE id = 1');
  if (result.rows.length === 0) {
    await pool.query('INSERT INTO config (id, data) VALUES (1, $1)', [JSON.stringify(defaultConfig)]);
  }
};

// ── Routes ──────────────────────────────────────────────────

// Public: get config
app.get('/api/config', async (req, res) => {
  try {
    const config = await getConfig();
    const { adminPassword, ...safe } = config;
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Config not found' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const config = await getConfig();
    if (req.body.password === config.adminPassword) {
      req.session.authenticated = true;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Wrong password' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Session check
app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// Save config
app.post('/api/config', requireAuth, async (req, res) => {
  try {
    const current = await getConfig();
    const updated = { ...current, ...req.body, adminPassword: current.adminPassword };
    await saveConfig(updated);
    res.json({ success: true, message: 'Settings saved successfully!' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Change password
app.post('/api/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const config = await getConfig();
    config.adminPassword = newPassword;
    await saveConfig(config);
    res.json({ success: true, message: 'Password changed!' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Upload image
app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    try {
      const target = req.body.target;
      let url;

      if (isProd) {
        // Cloudinary — req.file.path is the full secure URL
        url = req.file.path;
      } else {
        // Local — rename to correct target name
        const ext     = path.extname(req.file.originalname).toLowerCase();
        const newName = target + ext;
        const oldPath = req.file.path;
        const newPath = path.join(__dirname, newName);
        if (oldPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        }
        url = '/' + newName;
      }

      // Save URL to config
      const config   = await getConfig();
      config[target] = url;
      await saveConfig(config);

      res.json({ success: true, url });
    } catch (e) {
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── Start ────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log('SC Lending Corp. server started on port ' + PORT);
      console.log('Mode: ' + (isProd ? 'Production (PostgreSQL)' : 'Local (config.json)'));
    });
  })
  .catch(err => {
    console.error('DB init error (starting anyway):', err.message);
    // Start server even if DB init fails — prevents full crash
    app.listen(PORT, () => {
      console.log('SC Lending Corp. server started on port ' + PORT + ' (DB error — check DATABASE_URL)');
    });
  });
