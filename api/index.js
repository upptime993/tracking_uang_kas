const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
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
const transaksiSchema = new mongoose.Schema({
  tanggal: { type: Date, required: true },
  jenis: { type: String, enum: ['pemasukan', 'pengeluaran'], required: true },
  keterangan: { type: String, required: true },
  kategori: { type: String, required: true },
  nominal: { type: Number, required: true },
  sumber: { type: String, default: 'Kas Tunai' },
  createdAt: { type: Date, default: Date.now }
});

const anggotaSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  status: { type: String, enum: ['Sudah Bayar', 'Belum Bayar'], default: 'Belum Bayar' },
  totalBayar: { type: Number, default: 0 },
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
  bendahara: { type: String, default: 'Bendahara' },
  iuranPerBulan: { type: Number, default: 10000 },
  tahunAjaran: { type: String, default: '2024/2025' }
});

const Transaksi = mongoose.models.Transaksi || mongoose.model('Transaksi', transaksiSchema);
const Anggota = mongoose.models.Anggota || mongoose.model('Anggota', anggotaSchema);
const Anggaran = mongoose.models.Anggaran || mongoose.model('Anggaran', anggaranSchema);
const Pengaturan = mongoose.models.Pengaturan || mongoose.model('Pengaturan', pengaturanSchema);

// Connect DB sebelum setiap request
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// ==================== API ROUTES ====================

// Test route
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API berjalan!', mongodb: isConnected });
});

// SUMMARY
app.get('/api/summary', async (req, res) => {
  try {
    const transaksi = await Transaksi.find();
    const totalPemasukan = transaksi.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + t.nominal, 0);
    const totalPengeluaran = transaksi.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + t.nominal, 0);
    const saldo = totalPemasukan - totalPengeluaran;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const keluarHariIni = transaksi
      .filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= today)
      .reduce((s, t) => s + t.nominal, 0);

    const week = new Date(); week.setDate(week.getDate() - 7);
    const keluar7Hari = transaksi
      .filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= week)
      .reduce((s, t) => s + t.nominal, 0);

    res.json({ success: true, data: { saldo, totalPemasukan, totalPengeluaran, keluarHariIni, keluar7Hari } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// TRANSAKSI - GET
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

// TRANSAKSI - POST
app.post('/api/transaksi', async (req, res) => {
  try {
    const { tanggal, jenis, keterangan, kategori, nominal, sumber } = req.body;
    if (!tanggal || !jenis || !keterangan || !kategori || !nominal) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    const transaksi = new Transaksi({
      tanggal: new Date(tanggal), jenis, keterangan, kategori,
      nominal: parseFloat(nominal), sumber: sumber || 'Kas Tunai'
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

// TRANSAKSI - DELETE
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

// STATS
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

// ANGGOTA - GET
app.get('/api/anggota', async (req, res) => {
  try {
    const data = await Anggota.find().sort({ nama: 1 });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ANGGOTA - POST
app.post('/api/anggota', async (req, res) => {
  try {
    const { nama } = req.body;
    if (!nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
    const anggota = new Anggota({ nama });
    await anggota.save();
    res.json({ success: true, data: anggota, message: 'Anggota berhasil ditambahkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ANGGOTA - BAYAR
app.put('/api/anggota/:id/bayar', async (req, res) => {
  try {
    const { nominal } = req.body;
    const anggota = await Anggota.findById(req.params.id);
    if (!anggota) return res.status(404).json({ success: false, message: 'Anggota tidak ditemukan' });

    anggota.totalBayar += parseFloat(nominal);
    anggota.status = 'Sudah Bayar';
    await anggota.save();

    const transaksi = new Transaksi({
      tanggal: new Date(), jenis: 'pemasukan',
      keterangan: `Iuran Kas - ${anggota.nama}`,
      kategori: 'Iuran', nominal: parseFloat(nominal), sumber: 'Kas Tunai'
    });
    await transaksi.save();

    res.json({ success: true, data: anggota, message: 'Pembayaran berhasil dicatat' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ANGGOTA - DELETE
app.delete('/api/anggota/:id', async (req, res) => {
  try {
    await Anggota.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Anggota berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ANGGARAN - GET
app.get('/api/anggaran', async (req, res) => {
  try {
    const data = await Anggaran.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ANGGARAN - POST
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

// ANGGARAN - DELETE
app.delete('/api/anggaran/:id', async (req, res) => {
  try {
    await Anggaran.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Anggaran berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PENGATURAN - GET
app.get('/api/pengaturan', async (req, res) => {
  try {
    let data = await Pengaturan.findOne();
    if (!data) { data = new Pengaturan(); await data.save(); }
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PENGATURAN - PUT
app.put('/api/pengaturan', async (req, res) => {
  try {
    let data = await Pengaturan.findOne();
    if (!data) data = new Pengaturan();
    const { namaKelas, bendahara, iuranPerBulan, tahunAjaran } = req.body;
    if (namaKelas) data.namaKelas = namaKelas;
    if (bendahara) data.bendahara = bendahara;
    if (iuranPerBulan) data.iuranPerBulan = parseFloat(iuranPerBulan);
    if (tahunAjaran) data.tahunAjaran = tahunAjaran;
    await data.save();
    res.json({ success: true, data, message: 'Pengaturan berhasil disimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Serve HTML untuk semua route selain API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

module.exports = app;
