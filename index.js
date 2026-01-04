const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

// Database sederhana
const { Low, JSONFile } = require('lowdb');
const adapter = new JSONFile(path.join(__dirname, 'db.json'));
const db = new Low(adapter);

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Inisialisasi database
async function initDB() {
  await db.read();
  db.data ||= { 
    transactions: [],
    categories: {
      pemasukan: ['Gaji', 'Usaha', 'Investasi', 'Lainnya'],
      pengeluaran: ['Makanan', 'Transport', 'Belanja', 'Hiburan', 'Tagihan', 'Lainnya']
    },
    monthlyReports: {},
    settings: { currency: 'Rp', autoBackup: true }
  };
  await db.write();
}

// WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "bot-keuangan",
    dataPath: './session'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// ================= FUNGSI UTAMA =================

// 1. Catat Transaksi
async function catatTransaksi(type, jumlah, kategori, deskripsi = '') {
  await db.read();
  
  const transaction = {
    id: Date.now(),
    type: type, // 'pemasukan' atau 'pengeluaran'
    amount: parseInt(jumlah),
    category: kategori,
    description: deskripsi,
    date: moment().format('YYYY-MM-DD'),
    time: moment().format('HH:mm:ss'),
    timestamp: new Date().toISOString()
  };
  
  db.data.transactions.push(transaction);
  await db.write();
  
  return transaction;
}

// 2. Hitung Saldo
async function hitungSaldo() {
  await db.read();
  const transactions = db.data.transactions;
  
  const totalPemasukan = transactions
    .filter(t => t.type === 'pemasukan')
    .reduce((sum, t) => sum + t.amount, 0);
    
  const totalPengeluaran = transactions
    .filter(t => t.type === 'pengeluaran')
    .reduce((sum, t) => sum + t.amount, 0);
    
  return {
    saldo: totalPemasukan - totalPengeluaran,
    pemasukan: totalPemasukan,
    pengeluaran: totalPengeluaran
  };
}

// 3. Laporan Harian
async function laporanHarian(tanggal = moment().format('YYYY-MM-DD')) {
  await db.read();
  
  const hariIni = db.data.transactions.filter(t => t.date === tanggal);
  
  const pemasukan = hariIni
    .filter(t => t.type === 'pemasukan')
    .reduce((sum, t) => sum + t.amount, 0);
    
  const pengeluaran = hariIni
    .filter(t => t.type === 'pengeluaran')
    .reduce((sum, t) => sum + t.amount, 0);
    
  return {
    tanggal,
    totalTransaksi: hariIni.length,
    pemasukan,
    pengeluaran,
    saldo: pemasukan - pengeluaran,
    detail: hariIni
  };
}

// 4. Laporan Bulanan
async function laporanBulanan(bulan = moment().format('YYYY-MM')) {
  await db.read();
  
  const bulanIni = db.data.transactions.filter(t => 
    t.date.startsWith(bulan)
  );
  
  const byKategori = {};
  bulanIni.forEach(t => {
    if (!byKategori[t.category]) {
      byKategori[t.category] = { pemasukan: 0, pengeluaran: 0 };
    }
    byKategori[t.category][t.type] += t.amount;
  });
  
  const totalPemasukan = bulanIni
    .filter(t => t.type === 'pemasukan')
    .reduce((sum, t) => sum + t.amount, 0);
    
  const totalPengeluaran = bulanIni
    .filter(t => t.type === 'pengeluaran')
    .reduce((sum, t) => sum + t.amount, 0);
    
  // Simpan laporan bulanan
  if (!db.data.monthlyReports[bulan]) {
    db.data.monthlyReports[bulan] = {
      totalPemasukan,
      totalPengeluaran,
      saldo: totalPemasukan - totalPengeluaran,
      totalTransaksi: bulanIni.length,
      generatedAt: new Date().toISOString()
    };
    await db.write();
  }
  
  return {
    bulan,
    totalPemasukan,
    totalPengeluaran,
    saldo: totalPemasukan - totalPengeluaran,
    totalTransaksi: bulanIni.length,
    byKategori,
    transaksi: bulanIni
  };
}

// ================= FITUR CRON =================

// Auto-backup setiap jam
cron.schedule('0 * * * *', async () => {
  await db.read();
  const backupFile = `backup-${moment().format('YYYY-MM-DD-HH')}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(db.data, null, 2));
  console.log(`✅ Backup otomatis: ${backupFile}`);
});

// Laporan harian jam 21:00
cron.schedule('0 21 * * *', async () => {
  const laporan = await laporanHarian();
  const saldo = await hitungSaldo();
  
  // Kirim ke admin
  const adminNumber = '628xxxxxx@c.us'; // ganti dengan nomor admin
  const message = `📊 LAPORAN HARIAN ${moment().format('DD/MM/YYYY')}\n\n` +
                 `📈 Pemasukan: Rp ${laporan.pemasukan.toLocaleString()}\n` +
                 `📉 Pengeluaran: Rp ${laporan.pengeluaran.toLocaleString()}\n` +
                 `💰 Saldo Harian: Rp ${laporan.saldo.toLocaleString()}\n` +
                 `💵 Saldo Total: Rp ${saldo.saldo.toLocaleString()}\n` +
                 `📋 Total Transaksi: ${laporan.totalTransaksi}`;
  
  if (client.info) {
    client.sendMessage(adminNumber, message);
  }
});

// Notifikasi saldo rendah (jika saldo < 100k)
cron.schedule('0 9,18 * * *', async () => {
  const saldo = await hitungSaldo();
  if (saldo.saldo < 100000) {
    const adminNumber = '628xxxxxx@c.us';
    const message = `⚠️ PERINGATAN: Saldo rendah!\n` +
                   `Saldo saat ini: Rp ${saldo.saldo.toLocaleString()}\n` +
                   `Pemasukan: Rp ${saldo.pemasukan.toLocaleString()}\n` +
                   `Pengeluaran: Rp ${saldo.pengeluaran.toLocaleString()}`;
    
    if (client.info) {
      client.sendMessage(adminNumber, message);
    }
  }
});

// ================= WHATSAPP HANDLER =================

client.on('qr', (qr) => {
  console.log('📱 SCAN QR CODE:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ BOT KEUANGAN SIAP!');
});

client.on('message', async (message) => {
  const text = message.body.toLowerCase();
  const args = text.split(' ');
  const command = args[0];
  
  // PERINTAH: catat pemasukan
  if (command === '+') {
    const jumlah = args[1];
    const kategori = args[2] || 'Gaji';
    const deskripsi = args.slice(3).join(' ') || '';
    
    if (!jumlah || isNaN(jumlah)) {
      return message.reply('❌ Format: + [jumlah] [kategori] [deskripsi]\nContoh: + 500000 Gaji Bonus');
    }
    
    const transaksi = await catatTransaksi('pemasukan', jumlah, kategori, deskripsi);
    const saldo = await hitungSaldo();
    
    message.reply(`✅ Pemasukan dicatat!\n` +
                 `💰 Rp ${jumlah}\n` +
                 `🏷️ ${kategori}\n` +
                 `📝 ${deskripsi}\n` +
                 `💵 Saldo: Rp ${saldo.saldo.toLocaleString()}`);
  }
  
  // PERINTAH: catat pengeluaran
  else if (command === '-') {
    const jumlah = args[1];
    const kategori = args[2] || 'Lainnya';
    const deskripsi = args.slice(3).join(' ') || '';
    
    if (!jumlah || isNaN(jumlah)) {
      return message.reply('❌ Format: - [jumlah] [kategori] [deskripsi]\nContoh: - 50000 Makan Siang');
    }
    
    const transaksi = await catatTransaksi('pengeluaran', jumlah, kategori, deskripsi);
    const saldo = await hitungSaldo();
    
    message.reply(`✅ Pengeluaran dicatat!\n` +
                 `💸 Rp ${jumlah}\n` +
                 `🏷️ ${kategori}\n` +
                 `📝 ${deskripsi}\n` +
                 `💵 Saldo: Rp ${saldo.saldo.toLocaleString()}`);
  }
  
  // PERINTAH: saldo
  else if (command === 'saldo') {
    const saldo = await hitungSaldo();
    
    message.reply(`💰 LAPORAN SALDO\n\n` +
                 `📈 Total Pemasukan: Rp ${saldo.pemasukan.toLocaleString()}\n` +
                 `📉 Total Pengeluaran: Rp ${saldo.pengeluaran.toLocaleString()}\n` +
                 `💵 Saldo Sekarang: Rp ${saldo.saldo.toLocaleString()}\n\n` +
                 `📅 ${moment().format('DD/MM/YYYY HH:mm')}`);
  }
  
  // PERINTAH: hari ini
  else if (command === 'hariini') {
    const laporan = await laporanHarian();
    
    let detail = '';
    laporan.detail.forEach(t => {
      detail += `${t.type === 'pemasukan' ? '📈' : '📉'} ${t.time} - Rp ${t.amount.toLocaleString()} (${t.category})\n`;
    });
    
    message.reply(`📊 LAPORAN HARIAN ${laporan.tanggal}\n\n` +
                 `📈 Pemasukan: Rp ${laporan.pemasukan.toLocaleString()}\n` +
                 `📉 Pengeluaran: Rp ${laporan.pengeluaran.toLocaleString()}\n` +
                 `💰 Saldo: Rp ${laporan.saldo.toLocaleString()}\n` +
                 `📋 Total Transaksi: ${laporan.totalTransaksi}\n\n` +
                 `${detail || 'Tidak ada transaksi hari ini'}`);
  }
  
  // PERINTAH: bulan ini
  else if (command === 'bulanini') {
    const laporan = await laporanBulanan();
    
    let byCategory = '';
    Object.entries(laporan.byKategori).forEach(([kategori, data]) => {
      if (data.pemasukan > 0) {
        byCategory += `📈 ${kategori}: Rp ${data.pemasukan.toLocaleString()}\n`;
      }
      if (data.pengeluaran > 0) {
        byCategory += `📉 ${kategori}: Rp ${data.pengeluaran.toLocaleString()}\n`;
      }
    });
    
    message.reply(`📊 LAPORAN BULANAN ${laporan.bulan}\n\n` +
                 `📈 Total Pemasukan: Rp ${laporan.totalPemasukan.toLocaleString()}\n` +
                 `📉 Total Pengeluaran: Rp ${laporan.totalPengeluaran.toLocaleString()}\n` +
                 `💰 Saldo: Rp ${laporan.saldo.toLocaleString()}\n` +
                 `📋 Total Transaksi: ${laporan.totalTransaksi}\n\n` +
                 `${byCategory || 'Tidak ada transaksi bulan ini'}`);
  }
  
  // PERINTAH: kategori
  else if (command === 'kategori') {
    await db.read();
    
    message.reply(`🏷️ KATEGORI YANG TERSEDIA:\n\n` +
                 `📈 PEMASUKAN:\n${db.data.categories.pemasukan.join(', ')}\n\n` +
                 `📉 PENGELUARAN:\n${db.data.categories.pengeluaran.join(', ')}\n\n` +
                 `Gunakan: + [jumlah] [kategori]`);
  }
  
  // PERINTAH: export (format sederhana)
  else if (command === 'export') {
    await db.read();
    
    let exportText = '📋 EXPORT TRANSAKSI\n\n';
    db.data.transactions.forEach(t => {
      exportText += `${t.date} ${t.time} | ${t.type === 'pemasukan' ? '+' : '-'}Rp ${t.amount} | ${t.category} | ${t.description}\n`;
    });
    
    // Potong jika terlalu panjang
    if (exportText.length > 4000) {
      exportText = exportText.substring(0, 4000) + '\n\n... (data dipotong)';
    }
    
    message.reply(exportText);
  }
  
  // PERINTAH: help / menu
  else if (command === 'menu' || command === 'help') {
    message.reply(`🤖 BOT PENCATAT KEUANGAN\n\n` +
                 `📝 CATAT TRANSAKSI:\n` +
                 `• + 50000 Gaji "Gaji bulanan" (pemasukan)\n` +
                 `• - 25000 Makan "Makan siang" (pengeluaran)\n\n` +
                 `📊 LAPORAN:\n` +
                 `• saldo - Cek saldo total\n` +
                 `• hariini - Laporan harian\n` +
                 `• bulanini - Laporan bulanan\n` +
                 `• kategori - Lihat kategori\n` +
                 `• export - Export semua transaksi\n\n` +
                 `⏰ FITUR OTOMATIS:\n` +
                 `• Laporan harian jam 21:00\n` +
                 `• Backup otomatis setiap jam\n` +
                 `• Notifikasi saldo rendah\n\n` +
                 `📅 ${moment().format('DD/MM/YYYY')}`);
  }
});

// ================= EXPRESS SERVER =================

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bot Keuangan WhatsApp</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .command { background: #f5f5f5; padding: 10px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Bot Pencatat Keuangan WhatsApp</h1>
        <p>Online 24/7 di Render.com</p>
        
        <h2>📋 Perintah WhatsApp:</h2>
        <div class="command">
          <p><strong>+ 50000 Gaji</strong> - Catat pemasukan</p>
          <p><strong>- 25000 Makan</strong> - Catat pengeluaran</p>
          <p><strong>saldo</strong> - Cek saldo</p>
          <p><strong>hariini</strong> - Laporan harian</p>
          <p><strong>bulanini</strong> - Laporan bulanan</p>
          <p><strong>menu</strong> - Menu bantuan</p>
        </div>
        
        <h2>⏰ Fitur Otomatis:</h2>
        <ul>
          <li>Laporan harian jam 21:00</li>
          <li>Backup data setiap jam</li>
          <li>Notifikasi saldo rendah</li>
          <li>Update otomatis</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

app.get('/ping', async (req, res) => {
  const saldo = await hitungSaldo();
  res.json({
    status: 'alive',
    saldo: saldo.saldo,
    totalTransaksi: (await db.read()).data.transactions.length,
    lastBackup: fs.existsSync('backup.json') ? 'yes' : 'no'
  });
});

// ================= START BOT =================

async function startBot() {
  await initDB();
  
  app.listen(PORT, () => {
    console.log(`🌐 Server berjalan di port ${PORT}`);
  });
  
  client.initialize();
}

startBot();
