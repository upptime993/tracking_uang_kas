const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ==================== DATABASE ====================
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Error:', error.message);
  }
}

// ==================== SCHEMAS ====================
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nama: { type: String, required: true },
  role: { type: String, enum: ['admin', 'bendahara'], default: 'bendahara' },
  createdAt: { type: Date, default: Date.now }
});

const transaksiSchema = new mongoose.Schema({
  tanggal: { type: Date, required: true },
  jenis: { type: String, enum: ['pemasukan', 'pengeluaran'], required: true },
  keterangan: { type: String, required: true },
  kategori: { type: String, required: true },
  nominal: { type: Number, required: true },
  sumber: { type: String, default: 'Kas Tunai' },
  minggu: { type: Number, default: 1 },
  bulan: { type: Number },
  tahun: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

const siswaSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  pembayaran: [{
    minggu: { type: Number, required: true },
    bulan: { type: Number, required: true },
    tahun: { type: Number, required: true },
    nominal: { type: Number, default: 0 },
    status: { type: String, enum: ['Lunas', 'Belum Lunas'], default: 'Belum Lunas' },
    tanggalBayar: { type: Date }
  }],
  createdAt: { type: Date, default: Date.now }
});

const anggaranSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  kategori: { type: String, required: true },
  limit: { type: Number, required: true },
  terpakai: { type: Number, default: 0 },
  periode: { type: String, default: 'Bulanan' },
  createdAt: { type: Date, default: Date.now }
});

const pengaturanSchema = new mongoose.Schema({
  namaKelas: { type: String, default: 'Kelas X RPL' },
  iuranMinimal: { type: Number, default: 3000 },
  tahunAjaran: { type: String, default: '2024/2025' }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transaksi = mongoose.models.Transaksi || mongoose.model('Transaksi', transaksiSchema);
const Siswa = mongoose.models.Siswa || mongoose.model('Siswa', siswaSchema);
const Anggaran = mongoose.models.Anggaran || mongoose.model('Anggaran', anggaranSchema);
const Pengaturan = mongoose.models.Pengaturan || mongoose.model('Pengaturan', pengaturanSchema);

app.use(async (req, res, next) => { await connectDB(); next(); });

// ==================== HELPER ====================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getMinggu(tanggal) {
  const d = new Date(tanggal);
  const day = d.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });

    // Init admin default jika belum ada
    const adminCount = await User.countDocuments();
    if (adminCount === 0) {
      await new User({
        username: 'admin',
        password: hashPassword('admin123'),
        nama: 'Administrator',
        role: 'admin'
      }).save();
    }

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ success: false, message: 'Username tidak ditemukan' });

    if (user.password !== hashPassword(password)) {
      return res.status(401).json({ success: false, message: 'Password salah' });
    }

    res.json({
      success: true,
      data: { id: user._id, username: user.username, nama: user.nama, role: user.role },
      message: 'Login berhasil'
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// USER MANAGEMENT (admin only)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, nama, role } = req.body;
    if (!username || !password || !nama) return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(400).json({ success: false, message: 'Username sudah digunakan' });

    const user = new User({ username: username.toLowerCase(), password: hashPassword(password), nama, role: role || 'bendahara' });
    await user.save();
    res.json({ success: true, data: { id: user._id, username: user.username, nama: user.nama, role: user.role }, message: 'User berhasil ditambahkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { username, password, nama, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    if (username) user.username = username.toLowerCase();
    if (nama) user.nama = nama;
    if (role) user.role = role;
    if (password) user.password = hashPassword(password);

    await user.save();
    res.json({ success: true, message: 'User berhasil diupdate' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Tidak bisa hapus admin' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== SUMMARY ====================
app.get('/api/summary', async (req, res) => {
  try {
    const transaksi = await Transaksi.find();
    const totalPemasukan = transaksi.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + t.nominal, 0);
    const totalPengeluaran = transaksi.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + t.nominal, 0);
    const saldo = totalPemasukan - totalPengeluaran;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const keluarHariIni = transaksi.filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= today).reduce((s, t) => s + t.nominal, 0);
    const week = new Date(); week.setDate(week.getDate() - 7);
    const keluar7Hari = transaksi.filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= week).reduce((s, t) => s + t.nominal, 0);

    res.json({ success: true, data: { saldo, totalPemasukan, totalPengeluaran, keluarHariIni, keluar7Hari } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== TRANSAKSI ====================
app.get('/api/transaksi', async (req, res) => {
  try {
    const { jenis, limit } = req.query;
    let filter = {};
    if (jenis && jenis !== 'semua') filter.jenis = jenis;
    let query = Transaksi.find(filter).sort({ tanggal: -1, createdAt: -1 });
    if (limit) query = query.limit(parseInt(limit));
    const data = await query;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/transaksi', async (req, res) => {
  try {
    const { tanggal, jenis, keterangan, kategori, nominal, sumber } = req.body;
    if (!tanggal || !jenis || !keterangan || !kategori || !nominal) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    const tgl = new Date(tanggal);
    const transaksi = new Transaksi({
      tanggal: tgl, jenis, keterangan, kategori,
      nominal: parseFloat(nominal), sumber: sumber || 'Kas Tunai',
      minggu: getMinggu(tgl), bulan: tgl.getMonth() + 1, tahun: tgl.getFullYear()
    });
    await transaksi.save();
    if (jenis === 'pengeluaran') {
      await Anggaran.updateOne({ kategori }, { $inc: { terpakai: parseFloat(nominal) } });
    }
    res.json({ success: true, data: transaksi, message: 'Transaksi berhasil disimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/transaksi/:id', async (req, res) => {
  try {
    const transaksi = await Transaksi.findById(req.params.id);
    if (!transaksi) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    if (transaksi.jenis === 'pengeluaran') {
      await Anggaran.updateOne({ kategori: transaksi.kategori }, { $inc: { terpakai: -transaksi.nominal } });
    }
    await Transaksi.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== STATS ====================
app.get('/api/stats', async (req, res) => {
  try {
    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
    const startDate = new Date(tahun, bulan - 1, 1);
    const endDate = new Date(tahun, bulan, 0, 23, 59, 59);
    const transaksi = await Transaksi.find({ tanggal: { $gte: startDate, $lte: endDate } });
    const daysInMonth = endDate.getDate();
    const dailyData = [];

    for (let i = 1; i <= daysInMonth; i++) {
      const dayStart = new Date(tahun, bulan - 1, i);
      const dayEnd = new Date(tahun, bulan - 1, i, 23, 59, 59);
      const dayTrx = transaksi.filter(t => new Date(t.tanggal) >= dayStart && new Date(t.tanggal) <= dayEnd);
      dailyData.push({
        hari: i,
        pemasukan: dayTrx.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + t.nominal, 0),
        pengeluaran: dayTrx.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + t.nominal, 0)
      });
    }

    const pengeluaranTerbesar = transaksi.filter(t => t.jenis === 'pengeluaran').sort((a, b) => b.nominal - a.nominal).slice(0, 5);
    const kategoriMap = {};
    transaksi.filter(t => t.jenis === 'pengeluaran').forEach(t => {
      if (!kategoriMap[t.kategori]) kategoriMap[t.kategori] = 0;
      kategoriMap[t.kategori] += t.nominal;
    });
    const perKategori = Object.entries(kategoriMap).map(([nama, total]) => ({ nama, total }));

    res.json({ success: true, data: { dailyData, pengeluaranTerbesar, perKategori } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== SISWA ====================
app.get('/api/siswa', async (req, res) => {
  try {
    const data = await Siswa.find().sort({ nama: 1 });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/siswa', async (req, res) => {
  try {
    const { nama } = req.body;
    if (!nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
    const siswa = new Siswa({ nama });
    await siswa.save();
    res.json({ success: true, data: siswa, message: 'Siswa berhasil ditambahkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Tambah banyak siswa sekaligus
app.post('/api/siswa/bulk', async (req, res) => {
  try {
    const { namaList } = req.body;
    if (!namaList || !Array.isArray(namaList) || namaList.length === 0) {
      return res.status(400).json({ success: false, message: 'List nama wajib diisi' });
    }
    const inserted = [];
    const skipped = [];
    for (const nama of namaList) {
      const trimmed = nama.trim();
      if (!trimmed) continue;
      const existing = await Siswa.findOne({ nama: { $regex: new RegExp(`^${trimmed}$`, 'i') } });
      if (existing) { skipped.push(trimmed); continue; }
      const siswa = new Siswa({ nama: trimmed });
      await siswa.save();
      inserted.push(trimmed);
    }
    res.json({ success: true, data: { inserted, skipped }, message: `${inserted.length} siswa berhasil ditambahkan${skipped.length > 0 ? `, ${skipped.length} dilewati (duplikat)` : ''}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/siswa/:id/bayar', async (req, res) => {
  try {
    const { nominal, minggu, bulan, tahun } = req.body;
    const siswa = await Siswa.findById(req.params.id);
    if (!siswa) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    const pengaturan = await Pengaturan.findOne() || new Pengaturan();
    const iuranMinimal = pengaturan.iuranMinimal || 3000;
    const status = parseFloat(nominal) >= iuranMinimal ? 'Lunas' : 'Belum Lunas';

    const now = new Date();
    const targetMinggu = parseInt(minggu) || getMinggu(now);
    const targetBulan = parseInt(bulan) || (now.getMonth() + 1);
    const targetTahun = parseInt(tahun) || now.getFullYear();

    const existingIdx = siswa.pembayaran.findIndex(p =>
      p.minggu === targetMinggu && p.bulan === targetBulan && p.tahun === targetTahun
    );

    if (existingIdx >= 0) {
      siswa.pembayaran[existingIdx].nominal += parseFloat(nominal);
      siswa.pembayaran[existingIdx].status = siswa.pembayaran[existingIdx].nominal >= iuranMinimal ? 'Lunas' : 'Belum Lunas';
      siswa.pembayaran[existingIdx].tanggalBayar = now;
    } else {
      siswa.pembayaran.push({ minggu: targetMinggu, bulan: targetBulan, tahun: targetTahun, nominal: parseFloat(nominal), status, tanggalBayar: now });
    }

    siswa.markModified('pembayaran');
    await siswa.save();

    const transaksi = new Transaksi({
      tanggal: now, jenis: 'pemasukan',
      keterangan: `Iuran Kas Minggu ke-${targetMinggu} - ${siswa.nama}`,
      kategori: 'Iuran', nominal: parseFloat(nominal), sumber: 'Kas Tunai',
      minggu: targetMinggu, bulan: targetBulan, tahun: targetTahun
    });
    await transaksi.save();

    res.json({ success: true, data: siswa, message: `Pembayaran ${status === 'Lunas' ? 'LUNAS ✅' : 'tercatat (Belum Lunas) ⚠️'}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/siswa/:id', async (req, res) => {
  try {
    await Siswa.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Siswa berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== ANGGARAN ====================
app.get('/api/anggaran', async (req, res) => {
  try {
    const data = await Anggaran.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anggaran', async (req, res) => {
  try {
    const { nama, kategori, limit, periode } = req.body;
    if (!nama || !kategori || !limit) return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    const anggaran = new Anggaran({ nama, kategori, limit: parseFloat(limit), periode: periode || 'Bulanan' });
    await anggaran.save();
    res.json({ success: true, data: anggaran, message: 'Anggaran berhasil ditambahkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/anggaran/:id', async (req, res) => {
  try {
    await Anggaran.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Anggaran berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== PENGATURAN ====================
app.get('/api/pengaturan', async (req, res) => {
  try {
    let data = await Pengaturan.findOne();
    if (!data) { data = new Pengaturan(); await data.save(); }
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/pengaturan', async (req, res) => {
  try {
    let data = await Pengaturan.findOne();
    if (!data) data = new Pengaturan();
    const { namaKelas, iuranMinimal, tahunAjaran } = req.body;
    if (namaKelas) data.namaKelas = namaKelas;
    if (iuranMinimal !== undefined) data.iuranMinimal = parseFloat(iuranMinimal);
    if (tahunAjaran) data.tahunAjaran = tahunAjaran;
    await data.save();
    res.json({ success: true, data, message: 'Pengaturan berhasil disimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== SERVE HTML ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
module.exports = app;
