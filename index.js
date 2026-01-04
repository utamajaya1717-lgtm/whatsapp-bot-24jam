const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== KONFIGURASI ====================
const PREFIX = '!';
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '+6281234567890'; // Ganti dengan nomor admin
const adminWhatsAppID = ADMIN_NUMBER.includes('@') 
    ? ADMIN_NUMBER 
    : `${ADMIN_NUMBER.replace(/[^0-9]/g, '')}@c.us`;

const app = express();
const PORT = process.env.PORT || 3000;

// Database sederhana (gunakan JSON file)
const DB_PATH = path.join(__dirname, 'data.json');
let database = {
    users: {},
    transactions: [],
    balances: {},
    settings: {}
};

// Load database jika ada
if (fs.existsSync(DB_PATH)) {
    database = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDatabase() {
    fs.writeFileSync(DB_PATH, JSON.stringify(database, null, 2));
}

// Inisialisasi WhatsApp Client dengan LocalAuth
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './sessions'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let botReady = false;

// ==================== WEB SERVER (UNTUK RENDER) ====================
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot_ready: botReady,
        uptime: process.uptime(),
        project: 'WhatsApp Bot Pencatat Keuangan',
        endpoints: ['/health', '/status', '/transactions']
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

app.get('/status', (req, res) => {
    res.json({
        bot_ready: botReady,
        total_users: Object.keys(database.users).length,
        total_transactions: database.transactions.length,
        server_time: new Date().toISOString()
    });
});

app.get('/transactions', (req, res) => {
    res.json({
        transactions: database.transactions.slice(-10), // 10 transaksi terakhir
        total: database.transactions.length
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ==================== CRON JOBS ====================
// Laporan harian jam 20:00
cron.schedule('0 20 * * *', () => {
    if (botReady) {
        sendDailyReport();
    }
});

// Backup database setiap jam
cron.schedule('0 * * * *', () => {
    saveDatabase();
    console.log('💾 Database backup saved');
});

// ==================== WHATSAPP CLIENT ====================
console.log('🤖 WhatsApp Bot Pencatat Keuangan');
console.log(`📅 ${moment().format('DD MMMM YYYY HH:mm:ss')}`);
console.log(`🎯 Prefix: ${PREFIX}`);
console.log(`👑 Admin: ${adminWhatsAppID}`);

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code ready for scanning');
});

client.on('ready', () => {
    botReady = true;
    console.log('✅✅✅ BOT READY ✅✅✅');
    console.log('📝 Kirim "menu" untuk melihat fitur');
    
    // Notifikasi ke admin
    sendToAdmin('🤖 *Bot Keuangan Aktif!*\n' + 
                `📅 ${moment().format('DD/MM/YYYY HH:mm')}\n` +
                `👤 Total user: ${Object.keys(database.users).length}\n` +
                `💰 Total transaksi: ${database.transactions.length}`);
});

client.on('auth_failure', msg => {
    console.error('❌ AUTH FAILURE:', msg);
});

client.on('disconnected', reason => {
    console.log('🔌 Disconnected:', reason);
    botReady = false;
});

// ==================== FUNGSI BANTU ====================
function sendToAdmin(message) {
    if (botReady) {
        client.sendMessage(adminWhatsAppID, message).catch(console.error);
    }
}

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(number);
}

function getUserBalance(userId) {
    return database.balances[userId] || 0;
}

function updateBalance(userId, amount) {
    if (!database.balances[userId]) database.balances[userId] = 0;
    database.balances[userId] += amount;
    saveDatabase();
}

function addTransaction(userId, type, category, amount, description = '') {
    const transaction = {
        id: Date.now().toString(),
        userId,
        type, // 'income' atau 'expense'
        category,
        amount,
        description,
        date: moment().format('YYYY-MM-DD HH:mm:ss'),
        timestamp: Date.now()
    };
    
    database.transactions.push(transaction);
    
    // Update balance
    if (type === 'income') {
        updateBalance(userId, amount);
    } else {
        updateBalance(userId, -amount);
    }
    
    saveDatabase();
    return transaction;
}

function getDailySummary(userId, date = moment().format('YYYY-MM-DD')) {
    const userTransactions = database.transactions.filter(
        t => t.userId === userId && t.date.startsWith(date)
    );
    
    const income = userTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const expense = userTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
    
    return { income, expense, total: income - expense, count: userTransactions.length };
}

async function sendDailyReport() {
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
    
    for (const userId in database.users) {
        const todaySummary = getDailySummary(userId, today);
        const yesterdaySummary = getDailySummary(userId, yesterday);
        
        const report = `📊 *LAPORAN HARIAN*\n` +
                      `📅 ${moment().format('DD/MM/YYYY')}\n\n` +
                      `💰 *HARI INI:*\n` +
                      `├ Pemasukan: ${formatRupiah(todaySummary.income)}\n` +
                      `├ Pengeluaran: ${formatRupiah(todaySummary.expense)}\n` +
                      `└ Saldo: ${formatRupiah(todaySummary.total)}\n\n` +
                      `📈 *KEMARIN:*\n` +
                      `├ Pemasukan: ${formatRupiah(yesterdaySummary.income)}\n` +
                      `├ Pengeluaran: ${formatRupiah(yesterdaySummary.expense)}\n` +
                      `└ Saldo: ${formatRupiah(yesterdaySummary.total)}\n\n` +
                      `💎 Total Saldo: ${formatRupiah(getUserBalance(userId))}`;
        
        if (botReady) {
            await client.sendMessage(userId, report).catch(console.error);
        }
    }
}

// ==================== HANDLER PESAN (PERINTAH KEUANGAN) ====================
client.on('message', async message => {
    if (!botReady) return;
    
    const userId = message.from;
    const text = message.body.toLowerCase().trim();
    const originalText = message.body.trim();
    const args = originalText.split(' ');
    const command = args[0].toLowerCase();
    
    // Register user jika belum ada
    if (!database.users[userId]) {
        database.users[userId] = {
            registered: moment().format('YYYY-MM-DD HH:mm:ss'),
            name: (await message.getContact()).pushname || 'User',
            lastActive: moment().format('YYYY-MM-DD HH:mm:ss')
        };
        saveDatabase();
    }
    
    console.log(`📥 [${userId}] ${originalText}`);
    
    try {
        // ==================== PERINTAH UMUM ====================
        if (command === 'menu' || command === 'help') {
            const menu = `📱 *BOT PENCATAT KEUANGAN*\n\n` +
                        `💳 *TRANSAKSI:*\n` +
                        `➕ tambah [pemasukan/pengeluaran] [jumlah] [kategori] [deskripsi]\n` +
                        `📋 riwayat [hariini/kemarin]\n` +
                        `💰 saldo\n` +
                        `📊 laporan\n\n` +
                        `📅 *UTILITAS:*\n` +
                        `📈 ringkasan\n` +
                        `🗑️ hapus [id_transaksi]\n` +
                        `⚙️ kategori\n\n` +
                        `🎯 *LAINNYA:*\n` +
                        `ℹ️ info\n` +
                        `📞 owner\n` +
                        `💸 donasi`;
            
            await message.reply(menu);
            return;
        }
        
        if (command === 'ping') {
            const start = Date.now();
            const msg = await message.reply('🏓 Pinging...');
            const latency = Date.now() - start;
            await msg.edit(`🏓 Pong!\n⏱ ${latency}ms\n💾 ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`);
            return;
        }
        
        if (command === 'info' || command === 'status') {
            const summary = getDailySummary(userId);
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            
            const info = `🤖 *STATUS BOT*\n\n` +
                        `👤 User: ${database.users[userId].name}\n` +
                        `💰 Saldo: ${formatRupiah(getUserBalance(userId))}\n` +
                        `📅 Transaksi hari ini: ${summary.count}\n` +
                        `📊 Pemasukan: ${formatRupiah(summary.income)}\n` +
                        `📉 Pengeluaran: ${formatRupiah(summary.expense)}\n\n` +
                        `⚙️ Server: ${hours}h ${minutes}m\n` +
                        `📅 ${moment().format('DD MMM YYYY HH:mm')}`;
            
            await message.reply(info);
            return;
        }
        
        if (command === 'owner') {
            await message.reply(`👑 *Owner Bot*\n` +
                               `📞 ${ADMIN_NUMBER}\n` +
                               `💌 Butuh bantuan? Hubungi owner!`);
            return;
        }
        
        if (command === 'donasi') {
            await message.reply(`💝 *Donasi*\n\n` +
                               `Dukung pengembangan bot ini dengan donasi:\n` +
                               `💰 Gopay: 0812-3456-7890\n` +
                               `🏦 BCA: 1234567890\n\n` +
                               `Terima kasih atas supportnya! ❤️`);
            return;
        }
        
        // ==================== PERINTAH KEUANGAN ====================
        
        // tambah pemasukan/pengeluaran
        if (command === 'tambah') {
            if (args.length < 4) {
                await message.reply(`❌ Format salah!\n` +
                                   `Contoh: tambah pemasukan 50000 gaji "Gaji bulanan"\n` +
                                   `Contoh: tambah pengeluaran 20000 makanan "Makan siang"`);
                return;
            }
            
            const type = args[1];
            const amount = parseInt(args[2].replace(/[^0-9]/g, ''));
            const category = args[3];
            const description = args.slice(4).join(' ') || 'Tidak ada deskripsi';
            
            if (type !== 'pemasukan' && type !== 'pengeluaran') {
                await message.reply('❌ Jenis harus "pemasukan" atau "pengeluaran"');
                return;
            }
            
            if (isNaN(amount) || amount <= 0) {
                await message.reply('❌ Jumlah harus angka positif');
                return;
            }
            
            const transactionType = type === 'pemasukan' ? 'income' : 'expense';
            const transaction = addTransaction(userId, transactionType, category, amount, description);
            
            const emoji = type === 'pemasukan' ? '💹' : '📉';
            await message.reply(`${emoji} *Transaksi berhasil!*\n\n` +
                               `📋 ID: ${transaction.id}\n` +
                               `📅 ${transaction.date}\n` +
                               `💰 Jumlah: ${formatRupiah(amount)}\n` +
                               `🏷️ Kategori: ${category}\n` +
                               `📝 Deskripsi: ${description}\n\n` +
                               `💎 Saldo baru: ${formatRupiah(getUserBalance(userId))}`);
            return;
        }
        
        // riwayat transaksi
        if (command === 'riwayat') {
            let filterDate = moment().format('YYYY-MM-DD');
            if (args[1] === 'kemarin') {
                filterDate = moment().subtract(1, 'day').format('YYYY-MM-DD');
            }
            
            const userTransactions = database.transactions
                .filter(t => t.userId === userId && t.date.startsWith(filterDate))
                .slice(-10); // 10 transaksi terakhir
            
            if (userTransactions.length === 0) {
                await message.reply(`📭 Tidak ada transaksi ${args[1] || 'hari ini'}`);
                return;
            }
            
            let riwayat = `📋 *RIWAYAT TRANSAKSI*\n` +
                         `📅 ${moment(filterDate).format('DD/MM/YYYY')}\n\n`;
            
            userTransactions.forEach((t, i) => {
                const emoji = t.type === 'income' ? '➕' : '➖';
                riwayat += `${i+1}. ${emoji} ${formatRupiah(t.amount)}\n` +
                          `   🏷️ ${t.category}\n` +
                          `   📝 ${t.description || '-'}\n` +
                          `   🕐 ${t.date.split(' ')[1]}\n` +
                          `   🔸 ID: ${t.id}\n\n`;
            });
            
            const summary = getDailySummary(userId, filterDate);
            riwayat += `📊 *Ringkasan:*\n` +
                      `💰 Pemasukan: ${formatRupiah(summary.income)}\n` +
                      `📉 Pengeluaran: ${formatRupiah(summary.expense)}\n` +
                      `💎 Saldo: ${formatRupiah(summary.total)}`;
            
            await message.reply(riwayat);
            return;
        }
        
        // saldo
        if (command === 'saldo') {
            const balance = getUserBalance(userId);
            const summary = getDailySummary(userId);
            
            await message.reply(`💰 *SALDO ANDA*\n\n` +
                               `💎 Total: ${formatRupiah(balance)}\n\n` +
                               `📅 *Hari Ini:*\n` +
                               `➕ Pemasukan: ${formatRupiah(summary.income)}\n` +
                               `➖ Pengeluaran: ${formatRupiah(summary.expense)}\n` +
                               `📊 Bersih: ${formatRupiah(summary.total)}\n\n` +
                               `📈 Gunakan "ringkasan" untuk laporan lengkap`);
            return;
        }
        
        // ringkasan/laporan
        if (command === 'ringkasan' || command === 'laporan') {
            const today = getDailySummary(userId);
            const yesterday = getDailySummary(userId, moment().subtract(1, 'day').format('YYYY-MM-DD'));
            const thisMonth = moment().format('YYYY-MM');
            const monthTransactions = database.transactions.filter(
                t => t.userId === userId && t.date.startsWith(thisMonth)
            );
            
            const monthIncome = monthTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + t.amount, 0);
            
            const monthExpense = monthTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + t.amount, 0);
            
            const ringkasan = `📊 *RINGKASAN KEUANGAN*\n\n` +
                             `👤 ${database.users[userId].name}\n` +
                             `📅 ${moment().format('DD MMM YYYY')}\n\n` +
                             `💎 *SALDO:* ${formatRupiah(getUserBalance(userId))}\n\n` +
                             `📈 *HARI INI:*\n` +
                             `├ Pemasukan: ${formatRupiah(today.income)}\n` +
                             `├ Pengeluaran: ${formatRupiah(today.expense)}\n` +
                             `└ Total: ${formatRupiah(today.total)}\n\n` +
                             `📉 *KEMARIN:*\n` +
                             `├ Pemasukan: ${formatRupiah(yesterday.income)}\n` +
                             `├ Pengeluaran: ${formatRupiah(yesterday.expense)}\n` +
                             `└ Total: ${formatRupiah(yesterday.total)}\n\n` +
                             `📅 *BULAN INI (${moment().format('MMMM')}):*\n` +
                             `├ Pemasukan: ${formatRupiah(monthIncome)}\n` +
                             `├ Pengeluaran: ${formatRupiah(monthExpense)}\n` +
                             `└ Total: ${formatRupiah(monthIncome - monthExpense)}`;
            
            await message.reply(ringkasan);
            return;
        }
        
        // kategori
        if (command === 'kategori') {
            const userTransactions = database.transactions.filter(t => t.userId === userId);
            const categories = {};
            
            userTransactions.forEach(t => {
                categories[t.category] = (categories[t.category] || 0) + t.amount;
            });
            
            let kategoriMsg = `🏷️ *KATEGORI TRANSAKSI*\n\n`;
            
            Object.entries(categories).forEach(([cat, total], i) => {
                kategoriMsg += `${i+1}. ${cat}: ${formatRupiah(total)}\n`;
            });
            
            kategoriMsg += `\n📌 Total kategori: ${Object.keys(categories).length}`;
            
            await message.reply(kategoriMsg);
            return;
        }
        
        // hapus transaksi
        if (command === 'hapus') {
            if (args.length < 2) {
                await message.reply('❌ Format: hapus [id_transaksi]');
                return;
            }
            
            const transId = args[1];
            const index = database.transactions.findIndex(t => t.id === transId && t.userId === userId);
            
            if (index === -1) {
                await message.reply('❌ Transaksi tidak ditemukan atau bukan milik Anda');
                return;
            }
            
            const transaction = database.transactions[index];
            // Kembalikan saldo
            if (transaction.type === 'income') {
                updateBalance(userId, -transaction.amount);
            } else {
                updateBalance(userId, transaction.amount);
            }
            
            database.transactions.splice(index, 1);
            saveDatabase();
            
            await message.reply(`✅ Transaksi berhasil dihapus!\n` +
                               `📋 ID: ${transId}\n` +
                               `💰 ${formatRupiah(transaction.amount)}\n` +
                               `💎 Saldo baru: ${formatRupiah(getUserBalance(userId))}`);
            return;
        }
        
        // ==================== RESPON OTOMATIS ====================
        if (text.includes('terima kasih') || text.includes('thanks')) {
            await message.reply('Sama-sama! 😊');
            return;
        }
        
        if (text.includes('siapa kamu') || text.includes('whatsapp bot')) {
            await message.reply(`Saya adalah *WhatsApp Bot Pencatat Keuangan* 🤖\n` +
                               `Saya bisa membantu Anda mencatat pemasukan dan pengeluaran.\n` +
                               `Ketik *menu* untuk melihat fitur lengkap!`);
            return;
        }
        
    } catch (error) {
        console.error('❌ ERROR:', error);
        await message.reply('❌ Terjadi kesalahan sistem. Coba lagi nanti.');
    }
});

// ==================== INISIALISASI ====================
client.initialize();

// Handle errors
process.on('unhandledRejection', (error) => {
    console.error('🚨 UNHANDLED REJECTION:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    saveDatabase();
    process.exit(0);
});



client.on('qr', (qr) => {
  // ====== 1. PRINT STRING QR JELAS ======
  console.log('\n\n🔑 COPY STRING QR INI:');
  console.log('══════════════════════════════════════════════════');
  console.log('QR_STRING_START:' + qr + ':QR_STRING_END');
  console.log('══════════════════════════════════════════════════');
  
  // ====== 2. BUAT LINK UNTUK QR GAMBAR ======
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qr)}`;
  console.log('\n🌐 LINK UNTUK BUAT QR GAMBAR:');
  console.log(qrUrl);
  
  // ====== 3. SIMPAN KE FILE ======
  const fs = require('fs');
  fs.writeFileSync('qr_string.txt', qr);
  console.log('💾 QR string saved to qr_string.txt');
  
  // ====== 4. TAMPILKAN QR VISUAL (opsional) ======
  console.log('\n📱 QR VISUAL (jika mau coba scan):');
  qrcode.generate(qr, { small: false });
});



