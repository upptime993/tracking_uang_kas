const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ==================== MONGODB CONNECTION ====================
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB Error:', error);
  }
}

// ==================== SCHEMAS ====================

// Schema Transaksi
const transaksiSchema = new mongoose.Schema({
  tanggal: { type: Date, required: true },
  jenis: { type: String, enum: ['pemasukan', 'pengeluaran'], required: true },
  keterangan: { type: String, required: true },
  kategori: { type: String, required: true },
  nominal: { type: Number, required: true },
  sumber: { type: String, default: 'Kas Tunai' },
  createdAt: { type: Date, default: Date.now }
});

// Schema Anggota
const anggotaSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  status: { type: String, enum: ['Sudah Bayar', 'Belum Bayar'], default: 'Belum Bayar' },
  totalBayar: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Schema Anggaran
const anggaranSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  kategori: { type: String, required: true },
  limit: { type: Number, required: true },
  terpakai: { type: Number, default: 0 },
  periode: { type: String, default: 'Bulanan' },
  createdAt: { type: Date, default: Date.now }
});

// Schema Pengaturan
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

// ==================== MIDDLEWARE DB ====================
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// ==================== API ROUTES ====================

// --- DASHBOARD / SUMMARY ---
app.get('/api/summary', async (req, res) => {
  try {
    const transaksi = await Transaksi.find();
    
    const totalPemasukan = transaksi
      .filter(t => t.jenis === 'pemasukan')
      .reduce((sum, t) => sum + t.nominal, 0);
    
    const totalPengeluaran = transaksi
      .filter(t => t.jenis === 'pengeluaran')
      .reduce((sum, t) => sum + t.nominal, 0);
    
    const saldo = totalPemasukan - totalPengeluaran;

    // Pengeluaran hari ini
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const keluarHariIni = transaksi
      .filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= today)
      .reduce((sum, t) => sum + t.nominal, 0);

    // Pengeluaran 7 hari
    const week = new Date();
    week.setDate(week.getDate() - 7);
    const keluar7Hari = transaksi
      .filter(t => t.jenis === 'pengeluaran' && new Date(t.tanggal) >= week)
      .reduce((sum, t) => sum + t.nominal, 0);

    res.json({
      success: true,
      data: {
        saldo,
        totalPemasukan,
        totalPengeluaran,
        keluarHariIni,
        keluar7Hari
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- TRANSAKSI ROUTES ---
// GET semua transaksi
app.get('/api/transaksi', async (req, res) => {
  try {
    const { jenis, bulan, tahun, limit } = req.query;
    let filter = {};
    
    if (jenis) filter.jenis = jenis;
    
    if (bulan && tahun) {
      const startDate = new Date(tahun, bulan - 1, 1);
      const endDate = new Date(tahun, bulan, 0);
      filter.tanggal = { $gte: startDate, $lte: endDate };
    }
    
    let query = Transaksi.find(filter).sort({ tanggal: -1, createdAt: -1 });
    if (limit) query = query.limit(parseInt(limit));
    
    const transaksi = await query;
    res.json({ success: true, data: transaksi });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST tambah transaksi
app.post('/api/transaksi', async (req, res) => {
  try {
    const { tanggal, jenis, keterangan, kategori, nominal, sumber } = req.body;
    
    if (!tanggal || !jenis || !keterangan || !kategori || !nominal) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    
    const transaksi = new Transaksi({
      tanggal: new Date(tanggal),
      jenis,
      keterangan,
      kategori,
      nominal: parseFloat(nominal),
      sumber: sumber || 'Kas Tunai'
    });
    
    await transaksi.save();

    // Update anggaran jika pengeluaran
    if (jenis === 'pengeluaran') {
      await Anggaran.updateOne(
        { kategori: kategori },
        { $inc: { terpakai: parseFloat(nominal) } }
      );
    }
    
    res.json({ success: true, data: transaksi, message: 'Transaksi berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE transaksi
app.delete('/api/transaksi/:id', async (req, res) => {
  try {
    const transaksi = await Transaksi.findById(req.params.id);
    if (!transaksi) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }
    
    // Kembalikan anggaran
    if (transaksi.jenis === 'pengeluaran') {
      await Anggaran.updateOne(
        { kategori: transaksi.kategori },
        { $inc: { terpakai: -transaksi.nominal } }
      );
    }
    
    await Transaksi.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- STATS ROUTES ---
app.get('/api/stats', async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    const currentMonth = bulan || (new Date().getMonth() + 1);
    const currentYear = tahun || new Date().getFullYear();
    
    const startDate = new Date(currentYear, currentMonth - 1, 1);
    const endDate = new Date(currentYear, currentMonth, 0);
    
    const transaksi = await Transaksi.find({
      tanggal: { $gte: startDate, $lte: endDate }
    });

    // Data grafik harian
    const daysInMonth = endDate.getDate();
    const dailyData = [];
    
    for (let i = 1; i <= daysInMonth; i++) {
      const dayStart = new Date(currentYear, currentMonth - 1, i);
      const dayEnd = new Date(currentYear, currentMonth - 1, i, 23, 59, 59);
      
      const dayTransaksi = transaksi.filter(t => {
        const tDate = new Date(t.tanggal);
        return tDate >= dayStart && tDate <= dayEnd;
      });
      
      const pemasukan = dayTransaksi.filter(t => t.jenis === 'pemasukan').reduce((s, t) => s + t.nominal, 0);
      const pengeluaran = dayTransaksi.filter(t => t.jenis === 'pengeluaran').reduce((s, t) => s + t.nominal, 0);
      
      dailyData.push({ hari: i, pemasukan, pengeluaran });
    }

    // 5 pengeluaran terbesar
    const pengeluaranList = transaksi
      .filter(t => t.jenis === 'pengeluaran')
      .sort((a, b) => b.nominal - a.nominal)
      .slice(0, 5);

    // Per kategori
    const kategoriMap = {};
    transaksi.filter(t => t.jenis === 'pengeluaran').forEach(t => {
      if (!kategoriMap[t.kategori]) kategoriMap[t.kategori] = 0;
      kategoriMap[t.kategori] += t.nominal;
    });
    
    const perKategori = Object.entries(kategoriMap).map(([nama, total]) => ({ nama, total }));

    res.json({
      success: true,
      data: { dailyData, pengeluaranTerbesar: pengeluaranList, perKategori }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- ANGGOTA ROUTES ---
app.get('/api/anggota', async (req, res) => {
  try {
    const anggota = await Anggota.find().sort({ nama: 1 });
    res.json({ success: true, data: anggota });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/anggota', async (req, res) => {
  try {
    const { nama } = req.body;
    if (!nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
    
    const anggota = new Anggota({ nama });
    await anggota.save();
    res.json({ success: true, data: anggota, message: 'Anggota berhasil ditambahkan' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/anggota/:id/bayar', async (req, res) => {
  try {
    const { nominal } = req.body;
    const anggota = await Anggota.findById(req.params.id);
    if (!anggota) return res.status(404).json({ success: false, message: 'Anggota tidak ditemukan' });
    
    anggota.totalBayar += parseFloat(nominal);
    anggota.status = 'Sudah Bayar';
    await anggota.save();

    // Otomatis catat transaksi pemasukan
    const transaksi = new Transaksi({
      tanggal: new Date(),
      jenis: 'pemasukan',
      keterangan: `Iuran Kas - ${anggota.nama}`,
      kategori: 'Iuran',
      nominal: parseFloat(nominal),
      sumber: 'Kas Tunai'
    });
    await transaksi.save();
    
    res.json({ success: true, data: anggota, message: 'Pembayaran berhasil dicatat' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/anggota/:id', async (req, res) => {
  try {
    await Anggota.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Anggota berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- ANGGARAN ROUTES ---
app.get('/api/anggaran', async (req, res) => {
  try {
    const anggaran = await Anggaran.find().sort({ createdAt: -1 });
    res.json({ success: true, data: anggaran });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/anggaran', async (req, res) => {
  try {
    const { nama, kategori, limit, periode } = req.body;
    if (!nama || !kategori || !limit) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    
    const anggaran = new Anggaran({ nama, kategori, limit: parseFloat(limit), periode });
    await anggaran.save();
    res.json({ success: true, data: anggaran, message: 'Anggaran berhasil ditambahkan' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/anggaran/:id', async (req, res) => {
  try {
    await Anggaran.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Anggaran berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- PENGATURAN ROUTES ---
app.get('/api/pengaturan', async (req, res) => {
  try {
    let pengaturan = await Pengaturan.findOne();
    if (!pengaturan) {
      pengaturan = new Pengaturan();
      await pengaturan.save();
    }
    res.json({ success: true, data: pengaturan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/pengaturan', async (req, res) => {
  try {
    const { namaKelas, bendahara, iuranPerBulan, tahunAjaran } = req.body;
    let pengaturan = await Pengaturan.findOne();
    
    if (!pengaturan) {
      pengaturan = new Pengaturan();
    }
    
    if (namaKelas) pengaturan.namaKelas = namaKelas;
    if (bendahara) pengaturan.bendahara = bendahara;
    if (iuranPerBulan) pengaturan.iuranPerBulan = parseFloat(iuranPerBulan);
    if (tahunAjaran) pengaturan.tahunAjaran = tahunAjaran;
    
    await pengaturan.save();
    res.json({ success: true, data: pengaturan, message: 'Pengaturan berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
