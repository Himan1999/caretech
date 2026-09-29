const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const sql = require('mssql/msnodesqlv8');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'change-me-before-going-live';
const pool = new sql.ConnectionPool({
  server: process.env.CARETECH_SQL_SERVER || 'VALKYRIE1047\\SQLEXPRESS',
  database: process.env.CARETECH_SQL_DATABASE || 'CareTechDB',
  driver: 'ODBC Driver 17 for SQL Server',
  options: { trustedConnection: true, trustServerCertificate: true }
});
app.use(express.json());
app.use(express.static('public'));

const hash = (password, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');
const verify = (password, stored) => hash(password, stored.split(':')[0]) === stored;
const mac = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
const sign = user => { const body = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 6048e5 })).toString('base64url'); return body + '.' + mac(body); };
const pub = user => ({ name: user.name, email: user.email, role: user.role });
const query = async (text, inputs = {}) => { const request = pool.request(); Object.entries(inputs).forEach(([key, value]) => request.input(key, value)); return (await request.query(text)).recordset; };
const execute = async (text, inputs = {}) => { const request = pool.request(); Object.entries(inputs).forEach(([key, value]) => request.input(key, value)); return request.query(text); };
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });

async function auth(req, res, next) {
  try {
    const [body, signature] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
    if (!body || mac(body) !== signature) throw new Error('invalid token');
    const token = JSON.parse(Buffer.from(body, 'base64url'));
    req.user = (await query('SELECT Id AS id, Name AS name, Email AS email, Role AS role FROM dbo.Users WHERE Id = @id', { id: token.id }))[0];
    if (!req.user || token.exp < Date.now()) throw new Error('expired token');
    next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
}

async function seed() {
  const old = fs.existsSync('data.json') ? JSON.parse(fs.readFileSync('data.json')) : null;
  if (!(await query('SELECT COUNT(*) AS count FROM dbo.Users'))[0].count) {
    const users = old?.users?.length ? old.users : [{ id: 'admin', name: 'careTech Admin', email: 'admin@caretech.local', pass: hash('admin123'), role: 'admin' }];
    for (const user of users) await execute('INSERT INTO dbo.Users (Id, Name, Email, PasswordHash, Role) VALUES (@id, @name, @email, @pass, @role)', { id: user.id, name: user.name, email: user.email, pass: user.pass, role: user.role });
  }
  if (!(await query('SELECT COUNT(*) AS count FROM dbo.Services'))[0].count) {
    const services = old?.services || [
      { id: 's1', name: 'Printer installation', desc: 'Unboxing, setup, driver install, Wi-Fi and test print.', price: 59 },
      { id: 's2', name: 'Laptop setup', desc: 'Windows/macOS setup, updates, accounts, essential software.', price: 79 },
      { id: 's3', name: 'Phone setup and data transfer', desc: 'New phone configuration and moving your data across.', price: 49 }
    ];
    for (const service of services) await execute('INSERT INTO dbo.Services (Id, Name, Description, Price) VALUES (@id, @name, @description, @price)', { id: service.id, name: service.name, description: service.desc, price: service.price });
  }
  if (!(await query('SELECT COUNT(*) AS count FROM dbo.Products'))[0].count) for (const product of old?.products || []) await execute('INSERT INTO dbo.Products (Id, Name, Category, Description, Price, Stock) VALUES (@id, @name, @category, @description, @price, @stock)', { id: product.id, name: product.name, category: product.category, description: product.desc, price: product.price, stock: product.stock });
}

app.get('/api/catalog', async (req, res) => res.json({
  services: await query('SELECT Id AS id, Name AS name, Description AS [desc], Price AS price FROM dbo.Services WHERE IsActive = 1'),
  products: await query('SELECT Id AS id, Name AS name, Category AS category, Description AS [desc], Price AS price, Stock AS stock, Brand AS brand, Variant AS variant, Compatibility AS compatibility, Size AS size, ImageUrl AS imageUrl FROM dbo.Products WHERE IsActive = 1')
}));

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body, normalized = (email || '').toLowerCase();
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Name, email and a 6+ character password are required' });
  if ((await query('SELECT 1 FROM dbo.Users WHERE Email = @email', { email: normalized })).length) return res.status(400).json({ error: 'That email is already registered' });
  const user = { id: crypto.randomUUID(), name, email: normalized, pass: hash(password), role: 'customer' };
  await execute('INSERT INTO dbo.Users (Id, Name, Email, PasswordHash, Role) VALUES (@id, @name, @email, @pass, @role)', { id: user.id, name: user.name, email: user.email, pass: user.pass, role: user.role });
  res.json({ token: sign(user), user: pub(user) });
});

app.post('/api/login', async (req, res) => {
  const user = (await query('SELECT Id AS id, Name AS name, Email AS email, PasswordHash AS pass, Role AS role FROM dbo.Users WHERE Email = @email', { email: (req.body.email || '').toLowerCase() }))[0];
  if (!user || !verify(req.body.password || '', user.pass)) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: sign(user), user: pub(user) });
});

app.post('/api/orders', auth, async (req, res) => {
  const { items = [], address, date, notes } = req.body, lines = [];
  let total = 0;
  for (const item of items) {
    const qty = Math.max(1, parseInt(item.qty) || 1), isService = item.type === 'service';
    const table = isService ? 'Services' : 'Products';
    const found = (await query(`SELECT Id, Name, Price, Stock FROM dbo.${table} WHERE Id = @id AND IsActive = 1`, { id: item.id }))[0];
    if (!found) return res.status(400).json({ error: 'An item in your cart is no longer available' });
    if (!isService && found.Stock < qty) return res.status(400).json({ error: `Only ${found.Stock} of ${found.Name} left in stock` });
    lines.push({ type: isService ? 'service' : 'product', id: found.Id, name: found.Name, price: Number(found.Price), qty });
    total += Number(found.Price) * qty;
  }
  if (!lines.length) return res.status(400).json({ error: 'Your cart is empty' });
  if (lines.some(line => line.type === 'service') && (!address || !date)) return res.status(400).json({ error: 'Add an address and preferred date for service bookings' });
  const id = Date.now().toString(36), created = new Date().toISOString(), finalTotal = +total.toFixed(2);
  await execute('INSERT INTO dbo.Orders (Id, UserId, CustomerName, CustomerEmail, Total, Address, VisitDate, Notes, Status, CreatedAt) VALUES (@id, @userId, @customer, @email, @total, @address, @date, @notes, @status, @created)', { id, userId: req.user.id, customer: req.user.name, email: req.user.email, total: finalTotal, address: address || null, date: date || null, notes: notes || null, status: 'New', created });
  for (const line of lines) {
    await execute('INSERT INTO dbo.OrderItems (OrderId, ItemType, ItemId, ItemName, UnitPrice, Quantity) VALUES (@orderId, @type, @itemId, @name, @price, @qty)', { orderId: id, type: line.type, itemId: line.id, name: line.name, price: line.price, qty: line.qty });
    if (line.type === 'product') await execute('UPDATE dbo.Products SET Stock = Stock - @qty WHERE Id = @id', { qty: line.qty, id: line.id });
  }
  await execute('INSERT INTO dbo.Notifications (UserId, OrderId, Title, Message) VALUES (@userId, @orderId, @title, @message)', { userId: req.user.id, orderId: id, title: 'Order received', message: `Order ${id} is now being reviewed by the careTech team.` });
  res.json({ id, userId: req.user.id, customer: req.user.name, email: req.user.email, lines, total: finalTotal, address, date, notes, status: 'New', created });
});

async function getOrders(user) {
  const orders = user.role === 'admin' ? await query('SELECT * FROM dbo.Orders ORDER BY CreatedAt DESC') : await query('SELECT * FROM dbo.Orders WHERE UserId = @userId ORDER BY CreatedAt DESC', { userId: user.id });
  if (!orders.length) return [];
  const lines = await query(`SELECT * FROM dbo.OrderItems WHERE OrderId IN (${orders.map((_, i) => `@o${i}`).join(',')})`, Object.fromEntries(orders.map((order, i) => [`o${i}`, order.Id])));
  return orders.map(order => ({ id: order.Id, userId: order.UserId, customer: order.CustomerName, email: order.CustomerEmail, lines: lines.filter(line => line.OrderId === order.Id).map(line => ({ type: line.ItemType, id: line.ItemId, name: line.ItemName, price: Number(line.UnitPrice), qty: line.Quantity })), total: Number(order.Total), address: order.Address || '', date: order.VisitDate ? new Date(order.VisitDate).toISOString().slice(0, 10) : '', notes: order.Notes || '', status: order.Status, created: order.CreatedAt }));
}

app.get('/api/orders', auth, async (req, res) => res.json(await getOrders(req.user)));
app.get('/api/notifications', auth, async (req, res) => res.json(await query('SELECT Id AS id, OrderId AS orderId, Title AS title, Message AS message, IsRead AS isRead, CreatedAt AS created FROM dbo.Notifications WHERE UserId = @userId ORDER BY CreatedAt DESC', { userId: req.user.id })));
app.patch('/api/notifications/:id/read', auth, async (req, res) => { await execute('UPDATE dbo.Notifications SET IsRead = 1 WHERE Id = @id AND UserId = @userId', { id: req.params.id, userId: req.user.id }); res.json({ ok: true }); });

app.get('/api/admin/summary', auth, admin, async (req, res) => {
  const summary = (await query("SELECT (SELECT COUNT(*) FROM dbo.Users WHERE Role = 'customer') AS customers, (SELECT COUNT(*) FROM dbo.Orders) AS orders, (SELECT COUNT(*) FROM dbo.Orders WHERE Status IN ('New','Confirmed','In progress')) AS openOrders, (SELECT COALESCE(SUM(Total), 0) FROM dbo.Orders WHERE Status <> 'Cancelled') AS revenue"))[0];
  res.json({ customers: summary.customers, orders: summary.orders, openOrders: summary.openOrders, revenue: Number(summary.revenue) });
});

app.patch('/api/orders/:id', auth, admin, async (req, res) => {
  const allowed = ['New', 'Confirmed', 'In progress', 'Completed', 'Cancelled'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid order status' });
  const order = (await query('SELECT * FROM dbo.Orders WHERE Id = @id', { id: req.params.id }))[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await execute('UPDATE dbo.Orders SET Status = @status WHERE Id = @id', { status: req.body.status, id: req.params.id });
  await execute('INSERT INTO dbo.Notifications (UserId, OrderId, Title, Message) VALUES (@userId, @orderId, @title, @message)', { userId: order.UserId, orderId: order.Id, title: 'Order status updated', message: `Order ${order.Id} is now ${req.body.status}.` });
  res.json({ ok: true });
});
app.post('/api/products', auth, admin, async (req, res) => { const { name, price, stock, category, desc, brand, variant, compatibility, size, imageUrl } = req.body; if (!name || !(price >= 0)) return res.status(400).json({ error: 'Name and price are required' }); const product = { id: 'p' + Date.now(), name, category: category || 'Other', desc: desc || '', price: +price, stock: parseInt(stock) || 0, brand: brand || '', variant: variant || '', compatibility: compatibility || '', size: size || '', imageUrl: imageUrl || '' }; await execute('INSERT INTO dbo.Products (Id, Name, Category, Description, Price, Stock, Brand, Variant, Compatibility, Size, ImageUrl) VALUES (@id, @name, @category, @desc, @price, @stock, @brand, @variant, @compatibility, @size, @imageUrl)', product); res.json(product); });
app.delete('/api/products/:id', auth, admin, async (req, res) => { await execute('UPDATE dbo.Products SET IsActive = 0 WHERE Id = @id', { id: req.params.id }); res.json({ ok: true }); });

pool.connect().then(seed).then(() => app.listen(PORT, () => console.log(`careTech running at http://localhost:${PORT} using CareTechDB`))).catch(error => { console.error('Could not connect to CareTechDB:', error.message); process.exitCode = 1; });
