const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Simple JSON DB helpers
function loadDB(name) {
  const file = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function saveDB(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

// Seed data if empty
function seed() {
  let users = loadDB('users');
  if (users.length === 0) {
    users = [
      { id: 'u1', name: 'Admin', phone: '9999999999', role: 'admin', password: hash('admin123'), createdAt: Date.now() },
      { id: 'u2', name: 'Priya Sharma', phone: '9876543210', role: 'customer', password: hash('priya123'), address: 'Madhapur, Hyderabad', pincode: '500081', createdAt: Date.now() },
      { id: 'u3', name: 'Ravi Kumar', phone: '9123456789', role: 'helper', password: hash('ravi123'), skills: ['House Cleaning','Dishwashing','Ironing'], rating: 4.8, jobsDone: 42, available: true, createdAt: Date.now() },
      { id: 'u4', name: 'Lakshmi Devi', phone: '9988776655', role: 'helper', password: hash('lakshmi123'), skills: ['Cloth Washing','Ironing','Deep Cleaning'], rating: 4.9, jobsDone: 67, available: true, createdAt: Date.now() }
    ];
    saveDB('users', users);
  }
  let services = loadDB('services');
  if (services.length === 0) {
    services = [
      { id: 's1', name: 'House Cleaning', desc: 'Full house cleaning including floors, dusting & bathrooms', price: 499, duration: 120, icon: '🏠', category: 'cleaning' },
      { id: 's2', name: 'Dishwashing', desc: 'Kitchen utensils, plates, vessels cleaning', price: 199, duration: 45, icon: '🍽️', category: 'kitchen' },
      { id: 's3', name: 'Ironing', desc: 'Clothes ironing - up to 15 pieces', price: 149, duration: 60, icon: '👔', category: 'clothes' },
      { id: 's4', name: 'Cloth Washing', desc: 'Washing + drying of clothes (up to 5 kg)', price: 249, duration: 90, icon: '👕', category: 'clothes' },
      { id: 's5', name: 'Deep Cleaning', desc: 'Intensive deep clean of entire house', price: 999, duration: 240, icon: '✨', category: 'cleaning' },
      { id: 's6', name: 'Bathroom Cleaning', desc: 'Toilet, tiles, fittings deep clean', price: 299, duration: 60, icon: '🚿', category: 'cleaning' },
      { id: 's7', name: 'Kitchen Cleaning', desc: 'Kitchen cabinets, stove, sink & chimney', price: 349, duration: 75, icon: '🍳', category: 'kitchen' },
      { id: 's8', name: 'Sofa & Carpet Cleaning', desc: 'Sofa, carpet and upholstery cleaning', price: 599, duration: 90, icon: '🛋️', category: 'cleaning' }
    ];
    saveDB('services', services);
  }
  let bookings = loadDB('bookings');
  if (!bookings) saveDB('bookings', []);
}
seed();

// OTP store (in-memory, expires in 5 min)
const otpStore = new Map(); // phone -> { otp, expires, attempts }

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanExpiredOTPs() {
  const now = Date.now();
  for (const [phone, data] of otpStore.entries()) {
    if (data.expires < now) otpStore.delete(phone);
  }
}

function hash(str) {
  return crypto.createHash('sha256').update(str + 'cleankart_salt_2026').digest('hex');
}

function generateToken(user) {
  const payload = JSON.stringify({ id: user.id, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  return Buffer.from(payload).toString('base64') + '.' + crypto.createHmac('sha256', 'cleankart_secret').update(payload).digest('hex').slice(0, 16);
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expected = crypto.createHmac('sha256', 'cleankart_secret').update(payload).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function getAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return verifyToken(token);
}

// Rate limit simple (in-memory)
const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const key = ip;
  let entry = rateMap.get(key) || { count: 0, start: now };
  if (now - entry.start > 60000) { entry = { count: 0, start: now }; }
  entry.count++;
  rateMap.set(key, entry);
  return entry.count <= 60; // 60 req/min
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || 'unknown';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  if (!rateLimit(ip)) return send(res, 429, { error: 'Too many requests' });

  // Static files
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/') || pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.png') || pathname.endsWith('.ico') || pathname.endsWith('.svg') || pathname.endsWith('.json') || pathname.endsWith('.webmanifest'))) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  // ===== API =====
  try {
    // AUTH
    if (pathname === '/api/register' && method === 'POST') {
      const body = await parseBody(req);
      const { name, phone, password, role = 'customer', address, pincode, skills } = body;
      if (!name || !phone || !password) return send(res, 400, { error: 'Name, phone, password required' });
      if (!/^\d{10}$/.test(phone)) return send(res, 400, { error: 'Valid 10-digit phone required' });
      if (password.length < 6) return send(res, 400, { error: 'Password min 6 chars' });
      const users = loadDB('users');
      if (users.find(u => u.phone === phone)) return send(res, 400, { error: 'Phone already registered' });
      const user = {
        id: 'u' + Date.now(),
        name: String(name).slice(0, 50),
        phone,
        role: ['customer', 'helper'].includes(role) ? role : 'customer',
        password: hash(password),
        address: address || '',
        pincode: pincode || '',
        skills: Array.isArray(skills) ? skills : [],
        rating: 5.0,
        jobsDone: 0,
        available: true,
        createdAt: Date.now()
      };
      users.push(user);
      saveDB('users', users);
      const token = generateToken(user);
      return send(res, 201, { token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, address: user.address } });
    }

    
    // ===== OTP AUTH =====
    if (pathname === '/api/send-otp' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, purpose = 'login' } = body; // login | register
      if (!phone || !/^\d{10}$/.test(phone)) return send(res, 400, { error: 'Valid 10-digit phone required' });
      
      cleanExpiredOTPs();
      const existing = otpStore.get(phone);
      if (existing && existing.expires > Date.now() && (Date.now() - (existing.sentAt || 0)) < 30000) {
        return send(res, 429, { error: 'Please wait 30 seconds before requesting new OTP' });
      }

      const users = loadDB('users');
      const userExists = users.find(u => u.phone === phone);
      
      if (purpose === 'login' && !userExists) {
        return send(res, 404, { error: 'Phone not registered. Please sign up first.' });
      }
      if (purpose === 'register' && userExists) {
        return send(res, 400, { error: 'Phone already registered. Please login.' });
      }

      const otp = generateOTP();
      otpStore.set(phone, {
        otp,
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
        attempts: 0,
        purpose,
        sentAt: Date.now()
      });

      // DEMO MODE: return OTP in response (in real app this goes via SMS gateway)
      console.log(`[OTP] ${phone} → ${otp} (valid 5 min)`);
      return send(res, 200, {
        success: true,
        message: 'OTP sent successfully',
        demoOTP: otp,          // only for demo
        expiresIn: 300
      });
    }

    if (pathname === '/api/verify-otp' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, otp, name, role = 'customer', address } = body;
      if (!phone || !otp) return send(res, 400, { error: 'Phone and OTP required' });

      cleanExpiredOTPs();
      const stored = otpStore.get(phone);
      if (!stored) return send(res, 400, { error: 'OTP expired or not requested. Please request again.' });
      if (stored.expires < Date.now()) {
        otpStore.delete(phone);
        return send(res, 400, { error: 'OTP expired. Please request a new one.' });
      }
      if (stored.attempts >= 5) {
        otpStore.delete(phone);
        return send(res, 429, { error: 'Too many wrong attempts. Request new OTP.' });
      }

      if (stored.otp !== String(otp).trim()) {
        stored.attempts++;
        otpStore.set(phone, stored);
        return send(res, 400, { error: `Invalid OTP. ${5 - stored.attempts} attempts left.` });
      }

      // OTP correct → clear it
      otpStore.delete(phone);
      const users = loadDB('users');
      let user = users.find(u => u.phone === phone);

      if (stored.purpose === 'register' || !user) {
        // Create new user
        if (!name) return send(res, 400, { error: 'Name required for registration' });
        user = {
          id: 'u' + Date.now(),
          name: String(name).slice(0, 50),
          phone,
          role: ['customer', 'helper'].includes(role) ? role : 'customer',
          password: hash(otp + phone), // dummy
          address: address || '',
          pincode: '',
          skills: [],
          rating: 5.0,
          jobsDone: 0,
          available: true,
          createdAt: Date.now()
        };
        users.push(user);
        saveDB('users', users);
      }

      const token = generateToken(user);
      return send(res, 200, {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          address: user.address,
          skills: user.skills,
          rating: user.rating,
          jobsDone: user.jobsDone,
          available: user.available
        }
      });
    }


    if (pathname === '/api/login' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, password } = body;
      const users = loadDB('users');
      const user = users.find(u => u.phone === phone && u.password === hash(password));
      if (!user) return send(res, 401, { error: 'Invalid phone or password' });
      const token = generateToken(user);
      return send(res, 200, { token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, address: user.address, skills: user.skills, rating: user.rating, jobsDone: user.jobsDone, available: user.available } });
    }

    if (pathname === '/api/me' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Unauthorized' });
      const users = loadDB('users');
      const user = users.find(u => u.id === auth.id);
      if (!user) return send(res, 401, { error: 'User not found' });
      return send(res, 200, { id: user.id, name: user.name, phone: user.phone, role: user.role, address: user.address, pincode: user.pincode, skills: user.skills, rating: user.rating, jobsDone: user.jobsDone, available: user.available });
    }

    // SERVICES
    if (pathname === '/api/services' && method === 'GET') {
      return send(res, 200, loadDB('services'));
    }

    // HELPERS (available)
    if (pathname === '/api/helpers' && method === 'GET') {
      const users = loadDB('users').filter(u => u.role === 'helper' && u.available);
      return send(res, 200, users.map(u => ({ id: u.id, name: u.name, skills: u.skills, rating: u.rating, jobsDone: u.jobsDone })));
    }

    // BOOKINGS
    if (pathname === '/api/bookings' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Unauthorized' });
      let bookings = loadDB('bookings');
      if (auth.role === 'customer') bookings = bookings.filter(b => b.customerId === auth.id);
      else if (auth.role === 'helper') bookings = bookings.filter(b => b.helperId === auth.id || b.status === 'pending');
      // enrich
      const users = loadDB('users');
      const services = loadDB('services');
      bookings = bookings.map(b => {
        const cust = users.find(u => u.id === b.customerId);
        const help = users.find(u => u.id === b.helperId);
        const svc = services.find(s => s.id === b.serviceId);
        return { ...b, customerName: cust?.name, helperName: help?.name, serviceName: svc?.name, serviceIcon: svc?.icon };
      }).sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, bookings);
    }

    if (pathname === '/api/bookings' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth || auth.role !== 'customer') return send(res, 401, { error: 'Only customers can book' });
      const body = await parseBody(req);
      const { serviceId, date, time, address, pincode, notes } = body;
      if (!serviceId || !date || !time || !address) return send(res, 400, { error: 'serviceId, date, time, address required' });
      const services = loadDB('services');
      const service = services.find(s => s.id === serviceId);
      if (!service) return send(res, 404, { error: 'Service not found' });
      const booking = {
        id: 'b' + Date.now(),
        customerId: auth.id,
        serviceId,
        helperId: null,
        date,
        time,
        address: String(address).slice(0, 200),
        pincode: pincode || '500001',
        notes: notes || '',
        status: 'pending', // pending, accepted, in_progress, completed, cancelled
        price: service.price,
        rating: null,
        review: null,
        createdAt: Date.now(),
        city: 'Hyderabad'
      };
      const bookings = loadDB('bookings');
      bookings.push(booking);
      saveDB('bookings', bookings);
      return send(res, 201, booking);
    }

    // Accept / Update booking status (helper)
    if (pathname.startsWith('/api/bookings/') && method === 'PUT') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Unauthorized' });
      const id = pathname.split('/')[3];
      const body = await parseBody(req);
      const bookings = loadDB('bookings');
      const idx = bookings.findIndex(b => b.id === id);
      if (idx === -1) return send(res, 404, { error: 'Booking not found' });
      const b = bookings[idx];

      if (body.action === 'accept' && auth.role === 'helper') {
        if (b.status !== 'pending') return send(res, 400, { error: 'Already taken' });
        b.helperId = auth.id;
        b.status = 'accepted';
      } else if (body.action === 'start' && auth.role === 'helper' && b.helperId === auth.id) {
        b.status = 'in_progress';
      } else if (body.action === 'complete' && auth.role === 'helper' && b.helperId === auth.id) {
        b.status = 'completed';
        // update helper stats
        const users = loadDB('users');
        const hIdx = users.findIndex(u => u.id === auth.id);
        if (hIdx >= 0) {
          users[hIdx].jobsDone = (users[hIdx].jobsDone || 0) + 1;
          saveDB('users', users);
        }
      } else if (body.action === 'cancel' && (auth.role === 'customer' && b.customerId === auth.id || auth.role === 'helper' && b.helperId === auth.id)) {
        b.status = 'cancelled';
      } else if (body.action === 'rate' && auth.role === 'customer' && b.customerId === auth.id && b.status === 'completed') {
        b.rating = Math.min(5, Math.max(1, Number(body.rating) || 5));
        b.review = String(body.review || '').slice(0, 300);
        // update helper rating
        if (b.helperId) {
          const users = loadDB('users');
          const hIdx = users.findIndex(u => u.id === b.helperId);
          if (hIdx >= 0) {
            const old = users[hIdx].rating || 5;
            const jobs = users[hIdx].jobsDone || 1;
            users[hIdx].rating = Number(((old * (jobs - 1) + b.rating) / jobs).toFixed(1));
            saveDB('users', users);
          }
        }
      } else {
        return send(res, 403, { error: 'Not allowed' });
      }
      bookings[idx] = b;
      saveDB('bookings', bookings);
      return send(res, 200, b);
    }

    // Helper toggle availability
    if (pathname === '/api/helper/availability' && method === 'PUT') {
      const auth = getAuth(req);
      if (!auth || auth.role !== 'helper') return send(res, 401, { error: 'Unauthorized' });
      const body = await parseBody(req);
      const users = loadDB('users');
      const idx = users.findIndex(u => u.id === auth.id);
      if (idx === -1) return send(res, 404, { error: 'Not found' });
      users[idx].available = !!body.available;
      saveDB('users', users);
      return send(res, 200, { available: users[idx].available });
    }

    // Stats for dashboard
    if (pathname === '/api/stats' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Unauthorized' });
      const bookings = loadDB('bookings');
      if (auth.role === 'customer') {
        const mine = bookings.filter(b => b.customerId === auth.id);
        return send(res, 200, {
          total: mine.length,
          completed: mine.filter(b => b.status === 'completed').length,
          pending: mine.filter(b => b.status === 'pending' || b.status === 'accepted').length
        });
      }
      if (auth.role === 'helper') {
        const mine = bookings.filter(b => b.helperId === auth.id);
        const earnings = mine.filter(b => b.status === 'completed').reduce((s, b) => s + (b.price || 0), 0);
        return send(res, 200, {
          total: mine.length,
          completed: mine.filter(b => b.status === 'completed').length,
          pending: bookings.filter(b => b.status === 'pending').length,
          earnings
        });
      }
      return send(res, 200, {});
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 CleanKart running at http://localhost:${PORT}`);
  console.log(`   Hyderabad House Help Booking App`);
  console.log(`   Demo accounts:`);
  console.log(`   Customer → phone: 9876543210  pass: priya123`);
  console.log(`   Helper   → phone: 9123456789  pass: ravi123`);
  console.log(`   Admin    → phone: 9999999999  pass: admin123\n`);
});
