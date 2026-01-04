// Di bagian atas file
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Jangan lupa import fs jika belum ada

// ... konfigurasi lain ...

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
  fs.writeFileSync('qr_string.txt', qr);
  console.log('💾 QR string saved to qr_string.txt');
  
  // ====== 4. TAMPILKAN QR VISUAL (opsional) ======
  console.log('\n📱 QR VISUAL (jika mau coba scan):');
  qrcode.generate(qr, { small: false });
});

// Lanjutan event handlers...
client.on('ready', () => { ... });
























// ==================== IMPORTS ====================
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
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '+6281234567890';
const adminWhatsAppID = ADMIN_NUMBER.includes('@') 
    ? ADMIN_NUMBER 
    : `${ADMIN_NUMBER.replace(/[^0-9]/g, '')}@c.us`;

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== DATABASE ====================
const DB_PATH = path.join(__dirname, 'data.json');
let database = {
    users: {},
    transactions: [],
    balances: {},
    settings: {
        categories: ['makanan', 'transportasi', 'belanja', 'hiburan', 'tagihan', 'gaji', 'investasi', 'lainnya']
    }
};

// Load database jika ada
if (fs.existsSync(DB_PATH)) {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        database = JSON.parse(data);
        console.log(`✅ Database loaded: ${database.transactions.length} transactions, ${Object.keys(database.users).length} users`);
    } catch (error) {
        console.error('❌ Error loading database:', error.message);
        // Buat backup jika corrupt
        const backupPath = path.join(__dirname, `data-backup-${Date.now()}.json`);
        fs.writeFileSync(backupPath, data);
        console.log(`⚠️ Database corrupt, backup saved to ${backupPath}`);
    }
}

// Fungsi simpan database
function saveDatabase() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(database, null, 2));
        // Backup otomatis setiap 100 transaksi
        if (database.transactions.length % 100 === 0) {
            const backupPath = path.join(__dirname, `backups/data-backup-${moment().format('YYYY-MM-DD')}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(database, null, 2));
        }
    } catch (error) {
        console.error('❌ Error saving database:', error);
    }
}

// ==================== FUNGSI BANTU ====================
function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
}

function getUserBalance(userId) {
    return database.balances[userId] || 0;
}

function updateBalance(userId, amount) {
    if (!database.balances[userId]) database.balances[userId] = 0;
    database.balances[userId] += amount;
    if (database.balances[userId] < 0) database.balances[userId] = 0; // Tidak boleh minus
}

function addTransaction(userId, type, category, amount, description = '') {
    const transaction = {
        id: Date.now().toString(),
        userId,
        type, // 'income' atau 'expense'
        category,
        amount: parseInt(amount),
        description,
        date: moment().format('YYYY-MM-DD'),
        time: moment().format('HH:mm:ss'),
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

function getUserTransactions(userId, limit = 10) {
    return database.transactions
        .filter(t => t.userId === userId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
}

function getDailySummary(userId, date = moment().format('YYYY-MM-DD')) {
    const userTransactions = database.transactions.filter(
        t => t.userId === userId && t.date === date
    );
    
    const income = userTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const expense = userTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
    
    return { 
        income, 
        expense, 
        total: income - expense, 
        count: userTransactions.length,
        transactions: userTransactions 
    };
}

function getMonthlySummary(userId) {
    const month = moment().format('YYYY-MM');
    const userTransactions = database.transactions.filter(
        t => t.userId === userId && t.date.startsWith(month)
    );
    
    const income = userTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const expense = userTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
    
    // Kategori teratas
    const categories = {};
    userTransactions.forEach(t => {
        if (!categories[t.category]) categories[t.category] = 0;
        categories[t.category] += t.amount;
    });
    
    const topCategories = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    return { income, expense, total: income - expense, topCategories };
}

// ==================== WHATSAPP CLIENT ====================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-keuangan",
        dataPath: './sessions'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

let botReady = false;

// ==================== WEB SERVER ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot_ready: botReady,
        uptime: process.uptime(),
        project: 'WhatsApp Bot Pencatat Keuangan',
        endpoints: ['/health', '/status', '/transactions', '/users'],
        total_users: Object.keys(database.users).length,
        total_transactions: database.transactions.length
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        database_size: `${(JSON.stringify(database).length / 1024).toFixed(2)} KB`
    });
});

app.get('/status', (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    res.json({
        bot_ready: botReady,
        total_users: Object.keys(database.users).length,
        total_transactions: database.transactions.length,
        total_balance: Object.values(database.balances).reduce((a, b) => a + b, 0),
        server_time: new Date().toISOString(),
        uptime: `${hours}h ${minutes}m ${seconds}s`
    });
});

app.get('/users', (req, res) => {
    const users = Object.entries(database.users).map(([id, user]) => ({
        id,
        name: user.name,
        registered: user.registered,
        balance: database.balances[id] || 0,
        transaction_count: database.transactions.filter(t => t.userId === id).length
    }));
    
    res.json({
        users,
        count: users.length
    });
});

app.get('/transactions', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const transactions = database.transactions
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    
    res.json({
        transactions: transactions.map(t => ({
            ...t,
            amount_formatted: formatRupiah(t.amount)
        })),
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
        console.log('📊 Sending daily reports...');
        sendDailyReports();
    }
});

// Backup database setiap 6 jam
cron.schedule('0 */6 * * *', () => {
    saveDatabase();
    console.log('💾 Database backup completed');
});

// ==================== WHATSAPP EVENT HANDLERS ====================
console.log('🤖 WhatsApp Bot Pencatat Keuangan');
console.log(`📅 ${moment().format('dddd, DD MMMM YYYY HH:mm:ss')}`);
console.log(`🎯 Prefix: "${PREFIX}"`);
console.log(`👑 Admin: ${adminWhatsAppID}`);
console.log(`💾 Database: ${database.transactions.length} transaksi`);

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code generated, scan with WhatsApp');
});

client.on('ready', () => {
    botReady = true;
    console.log('✅✅✅ BOT READY ✅✅✅');
    console.log('📝 Send "menu" to see features');
    
    // Notify admin
    if (adminWhatsAppID) {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        client.sendMessage(adminWhatsAppID, 
            `🤖 *Bot Keuangan Aktif!*\n` +
            `⏰ ${moment().format('DD/MM/YYYY HH:mm')}\n` +
            `🔄 Uptime: ${hours}h ${minutes}m\n` +
            `👥 Users: ${Object.keys(database.users).length}\n` +
            `💰 Transaksi: ${database.transactions.length}\n` +
            `💎 Total Saldo: ${formatRupiah(Object.values(database.balances).reduce((a, b) => a + b, 0))}`
        ).catch(console.error);
    }
});

client.on('auth_failure', msg => {
    console.error('❌ AUTH FAILURE:', msg);
});

client.on('disconnected', reason => {
    console.log('🔌 Disconnected:', reason);
    botReady = false;
});

// ==================== MESSAGE HANDLER ====================
client.on('message', async message => {
    if (!botReady) {
        console.log('⏳ Bot not ready, ignoring message');
        return;
    }
    
    const userId = message.from;
    const text = message.body.toLowerCase().trim();
    const originalText = message.body.trim();
    const args = originalText.split(' ');
    const command = args[0].toLowerCase();
    
    // Log pesan
    console.log(`📥 [${moment().format('HH:mm:ss')}] ${userId.split('@')[0]}: ${originalText}`);
    
    try {
        // Register user jika belum ada
        if (!database.users[userId]) {
            let userName = 'User';
            try {
                // FIX: Handle getContact error
                const contact = await client.getContactById(userId).catch(() => null);
                if (contact) {
                    userName = contact.name || contact.pushname || userId.split('@')[0];
                }
            } catch (error) {
                console.log(`⚠️ Could not get contact info for ${userId}`);
            }
            
            database.users[userId] = {
                name: userName,
                registered: moment().format('YYYY-MM-DD HH:mm:ss'),
                lastActive: moment().format('YYYY-MM-DD HH:mm:ss')
            };
            
            if (!database.balances[userId]) {
                database.balances[userId] = 0;
            }
            
            saveDatabase();
            console.log(`👤 New user registered: ${userName} (${userId})`);
        }
        
        // Update last active
        database.users[userId].lastActive = moment().format('YYYY-MM-DD HH:mm:ss');
        
        // ==================== PERINTAH UMUM ====================
        if (command === 'menu' || command === 'help' || command === 'mulai') {
            const menu = `📱 *BOT PENCATAT KEUANGAN*\n` +
                       `_Catat pemasukan & pengeluaran dengan mudah_\n\n` +
                       `💳 *TRANSAKSI:*\n` +
                       `➕ ${PREFIX}tambah pemasukan [jumlah] [kategori] [deskripsi]\n` +
                       `➖ ${PREFIX}tambah pengeluaran [jumlah] [kategori] [deskripsi]\n` +
                       `📋 ${PREFIX}riwayat [hariini/kemarin]\n` +
                       `💰 ${PREFIX}saldo\n` +
                       `📊 ${PREFIX}ringkasan\n` +
                       `🗑️ ${PREFIX}hapus [id_transaksi]\n\n` +
                       `🏷️ ${PREFIX}kategori - Lihat kategori transaksi\n` +
                       `📅 ${PREFIX}bulanini - Ringkasan bulan ini\n` +
                       `ℹ️ ${PREFIX}info - Info akun & bot\n` +
                       `👑 ${PREFIX}owner - Hubungi owner\n\n` +
                       `📌 _Contoh: ${PREFIX}tambah pemasukan 5000000 gaji "Gaji bulan Januari"_`;
            
            await message.reply(menu);
            return;
        }
        
        if (command === 'ping') {
            const start = Date.now();
            const msg = await message.reply('🏓 Pinging...');
            const latency = Date.now() - start;
            await msg.edit(`🏓 Pong!\n⏱ ${latency}ms\n📅 ${moment().format('HH:mm:ss')}`);
            return;
        }
        
        if (command === 'info' || command === 'status') {
            const summary = getDailySummary(userId);
            const monthly = getMonthlySummary(userId);
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            
            const info = `🤖 *INFO BOT & AKUN*\n\n` +
                        `👤 ${database.users[userId].name}\n` +
                        `📅 Bergabung: ${moment(database.users[userId].registered).format('DD/MM/YY')}\n\n` +
                        `💰 *SALDO:* ${formatRupiah(getUserBalance(userId))}\n\n` +
                        `📊 *HARI INI:*\n` +
                        `├ Transaksi: ${summary.count}\n` +
                        `├ Pemasukan: ${formatRupiah(summary.income)}\n` +
                        `├ Pengeluaran: ${formatRupiah(summary.expense)}\n` +
                        `└ Total: ${formatRupiah(summary.total)}\n\n` +
                        `📅 *BULAN INI:*\n` +
                        `├ Pemasukan: ${formatRupiah(monthly.income)}\n` +
                        `├ Pengeluaran: ${formatRupiah(monthly.expense)}\n` +
                        `└ Total: ${formatRupiah(monthly.total)}\n\n` +
                        `⚙️ Server: ${hours}h ${minutes}m up`;
            
            await message.reply(info);
            return;
        }
        
        if (command === 'owner') {
            await message.reply(`👑 *OWNER BOT*\n\n` +
                               `📞 ${ADMIN_NUMBER}\n` +
                               `💌 Ada masalah? Hubungi owner!\n\n` +
                               `💝 Support bot dengan donasi:`);
            return;
        }
        
        // ==================== PERINTAH KEUANGAN ====================
        
        // Tambah transaksi
        if (command === 'tambah') {
            if (args.length < 4) {
                await message.reply(`❌ *Format salah!*\n\n` +
                                   `✅ Contoh pemasukan:\n` +
                                   `"${PREFIX}tambah pemasukan 50000 makanan "Makan siang"`\n\n` +
                                   `✅ Contoh pengeluaran:\n` +
                                   `"${PREFIX}tambah pengeluaran 200000 belanja "Bulanan"`\n\n` +
                                   `🏷️ Kategori: ${database.settings.categories.join(', ')}`);
                return;
            }
            
            const type = args[1].toLowerCase();
            const amount = parseInt(args[2].replace(/[^0-9]/g, ''));
            const category = args[3].toLowerCase();
            const description = args.slice(4).join(' ') || 'Tidak ada deskripsi';
            
            // Validasi
            if (type !== 'pemasukan' && type !== 'pengeluaran') {
                await message.reply('❌ Jenis harus "pemasukan" atau "pengeluaran"');
                return;
            }
            
            if (isNaN(amount) || amount <= 0) {
                await message.reply('❌ Jumlah harus angka positif (minimal 1)');
                return;
            }
            
            if (amount > 1000000000) { // Batas 1 milyar
                await message.reply('❌ Jumlah terlalu besar (maksimal 1.000.000.000)');
                return;
            }
            
            // Proses transaksi
            const transactionType = type === 'pemasukan' ? 'income' : 'expense';
            const transaction = addTransaction(userId, transactionType, category, amount, description);
            
            const emoji = type === 'pemasukan' ? '💹' : '📉';
            await message.reply(`${emoji} *TRANSAKSI BERHASIL!*\n\n` +
                               `📋 ID: ${transaction.id}\n` +
                               `📅 ${transaction.date} ${transaction.time}\n` +
                               `💰 Jumlah: ${formatRupiah(amount)}\n` +
                               `🏷️ Kategori: ${category}\n` +
                               `📝 Deskripsi: ${description}\n\n` +
                               `💎 Saldo baru: ${formatRupiah(getUserBalance(userId))}`);
            return;
        }
        
        // Riwayat transaksi
        if (command === 'riwayat') {
            let filterDate = moment().format('YYYY-MM-DD');
            let title = 'HARI INI';
            
            if (args[1] === 'kemarin') {
                filterDate = moment().subtract(1, 'day').format('YYYY-MM-DD');
                title = 'KEMARIN';
            } else if (args[1] === 'semua') {
                // Tampilkan semua (max 15)
                const userTransactions = getUserTransactions(userId, 15);
                
                if (userTransactions.length === 0) {
                    await message.reply('📭 Belum ada transaksi');
                    return;
                }
                
                let riwayat = `📋 *RIWAYAT TRANSAKSI* (15 terakhir)\n\n`;
                let totalIncome = 0;
                let totalExpense = 0;
                
                userTransactions.forEach((t, i) => {
                    const emoji = t.type === 'income' ? '➕' : '➖';
                    const typeText = t.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
                    
                    riwayat += `${i+1}. ${emoji} *${typeText}*\n` +
                              `   💰 ${formatRupiah(t.amount)}\n` +
                              `   🏷️ ${t.category}\n` +
                              `   📝 ${t.description || '-'}\n` +
                              `   📅 ${t.date} ${t.time}\n` +
                              `   🔸 ID: ${t.id}\n\n`;
                    
                    if (t.type === 'income') totalIncome += t.amount;
                    else totalExpense += t.amount;
                });
                
                riwayat += `📊 *TOTAL:*\n` +
                          `➕ Pemasukan: ${formatRupiah(totalIncome)}\n` +
                          `➖ Pengeluaran: ${formatRupiah(totalExpense)}\n` +
                          `💎 Saldo: ${formatRupiah(totalIncome - totalExpense)}`;
                
                await message.reply(riwayat);
                return;
            }
            
            const summary = getDailySummary(userId, filterDate);
            
            if (summary.count === 0) {
                await message.reply(`📭 Tidak ada transaksi ${title.toLowerCase()}`);
                return;
            }
            
            let riwayat = `📋 *RIWAYAT ${title}*\n` +
                         `📅 ${moment(filterDate).format('DD/MM/YYYY')}\n\n`;
            
            summary.transactions.forEach((t, i) => {
                const emoji = t.type === 'income' ? '➕' : '➖';
                riwayat += `${i+1}. ${emoji} ${formatRupiah(t.amount)}\n` +
                          `   🏷️ ${t.category}\n` +
                          `   📝 ${t.description || '-'}\n` +
                          `   🕐 ${t.time}\n` +
                          `   🔸 ID: ${t.id}\n\n`;
            });
            
            riwayat += `📊 *Ringkasan:*\n` +
                      `➕ Pemasukan: ${formatRupiah(summary.income)}\n` +
                      `➖ Pengeluaran: ${formatRupiah(summary.expense)}\n` +
                      `💎 Total: ${formatRupiah(summary.total)}`;
            
            await message.reply(riwayat);
            return;
        }
        
        // Saldo
        if (command === 'saldo') {
            const balance = getUserBalance(userId);
            const summary = getDailySummary(userId);
            
            await message.reply(`💰 *SALDO ANDA*\n\n` +
                               `💎 Total: ${formatRupiah(balance)}\n\n` +
                               `📅 *Hari Ini:*\n` +
                               `➕ Pemasukan: ${formatRupiah(summary.income)}\n` +
                               `➖ Pengeluaran: ${formatRupiah(summary.expense)}\n` +
                               `📊 Bersih: ${formatRupiah(summary.total)}\n\n` +
                               `💡 Tips: Catat semua transaksi untuk analisis yang akurat!`);
            return;
        }
        
        // Ringkasan
        if (command === 'ringkasan') {
            const today = getDailySummary(userId);
            const yesterday = getDailySummary(userId, moment().subtract(1, 'day').format('YYYY-MM-DD'));
            const monthly = getMonthlySummary(userId);
            
            const ringkasan = `📊 *RINGKASAN KEUANGAN*\n\n` +
                             `👤 ${database.users[userId].name}\n` +
                             `📅 ${moment().format('DD MMMM YYYY')}\n\n` +
                             `💎 *SALDO:* ${formatRupiah(getUserBalance(userId))}\n\n` +
                             `📈 *HARI INI:*\n` +
                             `├ Transaksi: ${today.count}\n` +
                             `├ Pemasukan: ${formatRupiah(today.income)}\n` +
                             `├ Pengeluaran: ${formatRupiah(today.expense)}\n` +
                             `└ Total: ${formatRupiah(today.total)}\n\n` +
                             `📉 *KEMARIN:*\n` +
                             `├ Pemasukan: ${formatRupiah(yesterday.income)}\n` +
                             `├ Pengeluaran: ${formatRupiah(yesterday.expense)}\n` +
                             `└ Total: ${formatRupiah(yesterday.total)}\n\n` +
                             `📅 *BULAN INI (${moment().format('MMMM')}):*\n` +
                             `├ Pemasukan: ${formatRupiah(monthly.income)}\n` +
                             `├ Pengeluaran: ${formatRupiah(monthly.expense)}\n` +
                             `└ Total: ${formatRupiah(monthly.total)}`;
            
            if (monthly.topCategories.length > 0) {
                ringkasan += `\n\n🏷️ *KATEGORI TERBESAR:*\n`;
                monthly.topCategories.forEach(([cat, amount], i) => {
                    ringkasan += `${i+1}. ${cat}: ${formatRupiah(amount)}\n`;
                });
            }
            
            await message.reply(ringkasan);
            return;
        }
        
        // Bulan ini
        if (command === 'bulanini') {
            const monthly = getMonthlySummary(userId);
            
            let bulanMsg = `📅 *RINGKASAN BULAN ${moment().format('MMMM YYYY').toUpperCase()}*\n\n`;
            bulanMsg += `➕ Pemasukan: ${formatRupiah(monthly.income)}\n`;
            bulanMsg += `➖ Pengeluaran: ${formatRupiah(monthly.expense)}\n`;
            bulanMsg += `💎 Total: ${formatRupiah(monthly.total)}\n`;
            
            if (monthly.topCategories.length > 0) {
                bulanMsg += `\n🏷️ *PENGELUARAN TERBESAR:*\n`;
                monthly.topCategories.forEach(([cat, amount], i) => {
                    if (amount > 0) {
                        bulanMsg += `${i+1}. ${cat}: ${formatRupiah(amount)}\n`;
                    }
                });
            }
            
            bulanMsg += `\n💡 _Catatan: Data dari 1 ${moment().format('MMMM')} sampai hari ini_`;
            
            await message.reply(bulanMsg);
            return;
        }
        
        // Kategori
        if (command === 'kategori') {
            const userTransactions = database.transactions.filter(t => t.userId === userId);
            const categories = {};
            
            userTransactions.forEach(t => {
                if (!categories[t.category]) categories[t.category] = { income: 0, expense: 0 };
                if (t.type === 'income') {
                    categories[t.category].income += t.amount;
                } else {
                    categories[t.category].expense += t.amount;
                }
            });
            
            let kategoriMsg = `🏷️ *KATEGORI TRANSAKSI*\n\n`;
            kategoriMsg += `📌 *Kategori default:* ${database.settings.categories.join(', ')}\n\n`;
            
            if (Object.keys(categories).length === 0) {
                kategoriMsg += `📭 Belum ada transaksi yang tercatat`;
            } else {
                Object.entries(categories).forEach(([cat, data], i) => {
                    kategoriMsg += `${i+1}. *${cat}*\n`;
                    if (data.income > 0) {
                        kategoriMsg += `   ➕ Pemasukan: ${formatRupiah(data.income)}\n`;
                    }
                    if (data.expense > 0) {
                        kategoriMsg += `   ➖ Pengeluaran: ${formatRupiah(data.expense)}\n`;
                    }
                    kategoriMsg += `   💎 Total: ${formatRupiah(data.income - data.expense)}\n\n`;
                });
            }
            
            kategoriMsg += `\n💡 Anda bisa menggunakan kategori apapun, tidak terbatas pada list di atas`;
            
            await message.reply(kategoriMsg);
            return;
        }
        
        // Hapus transaksi
        if (command === 'hapus') {
            if (args.length < 2) {
                await message.reply(`❌ Format: ${PREFIX}hapus [id_transaksi]\n` +
                                   `📋 Dapatkan ID dari perintah "${PREFIX}riwayat"`);
                return;
            }
            
            const transId = args[1];
            const index = database.transactions.findIndex(t => t.id === transId && t.userId === userId);
            
            if (index === -1) {
                await message.reply('❌ Transaksi tidak ditemukan atau bukan milik Anda');
                return;
            }
            
            const transaction = database.transactions[index];
            
            // Konfirmasi hapus
            if (args[2] !== 'ya') {
                await message.reply(`⚠️ *KONFIRMASI HAPUS TRANSAKSI*\n\n` +
                                   `📋 ID: ${transaction.id}\n` +
                                   `💰 ${formatRupiah(transaction.amount)}\n` +
                                   `🏷️ ${transaction.category}\n` +
                                   `📝 ${transaction.description || '-'}\n` +
                                   `📅 ${transaction.date}\n\n` +
                                   `⚠️ Hapus transaksi ini?\n` +
                                   `✅ Balas: "${PREFIX}hapus ${transId} ya"\n` +
                                   `❌ Batalkan: Abaikan pesan ini`);
                return;
            }
            
            // Eksekusi hapus
            if (transaction.type === 'income') {
                updateBalance(userId, -transaction.amount);
            } else {
                updateBalance(userId, transaction.amount);
            }
            
            database.transactions.splice(index, 1);
            saveDatabase();
            
            await message.reply(`✅ *TRANSAKSI DIHAPUS!*\n\n` +
                               `📋 ID: ${transId}\n` +
                               `💰 ${formatRupiah(transaction.amount)}\n` +
                               `💎 Saldo baru: ${formatRupiah(getUserBalance(userId))}\n\n` +
                               `🗑️ Transaksi telah dihapus permanen`);
            return;
        }
        
        // ==================== RESPON OTOMATIS ====================
        if (text.includes('terima kasih') || text.includes('makasih')) {
            await message.reply('Sama-sama! 😊 Semoga keuangan Anda sehat selalu! 💰');
            return;
        }
        
        if (text.includes('hai bot') || text === 'bot') {
            await message.reply(`Halo! 👋 Saya bot pencatat keuangan.\n` +
                               `Saya bisa membantu mencatat pemasukan & pengeluaran.\n` +
                               `Ketik *${PREFIX}menu* untuk melihat fitur lengkap!`);
            return;
        }
        
        if (text.includes('saldo') && text.length < 10) {
            const balance = getUserBalance(userId);
            await message.reply(`💰 Saldo Anda saat ini: ${formatRupiah(balance)}\n` +
                               `Ketik *${PREFIX}ringkasan* untuk detail lengkap`);
            return;
        }
        
        // Jika tidak ada command yang cocok
        if (command.startsWith(PREFIX)) {
            await message.reply(`❌ Perintah tidak dikenali: ${command}\n` +
                               `Ketik *${PREFIX}menu* untuk melihat daftar perintah`);
        }
        
    } catch (error) {
        console.error(`❌ ERROR [${userId}]:`, error);
        await message.reply('❌ Maaf, terjadi kesalahan sistem. Coba lagi nanti atau hubungi admin.');
    }
});

// ==================== FUNGSI TAMBAHAN ====================
async function sendDailyReports() {
    console.log(`📊 Mengirim laporan harian ke ${Object.keys(database.users).length} users`);
    
    for (const userId in database.users) {
        try {
            const today = getDailySummary(userId);
            const monthly = getMonthlySummary(userId);
            
            if (today.count === 0 && monthly.income === 0 && monthly.expense === 0) {
                continue; // Skip jika tidak ada aktivitas
            }
            
            const report = `📊 *LAPORAN KEUANGAN HARIAN*\n` +
                          `📅 ${moment().format('dddd, DD MMMM YYYY')}\n\n` +
                          `💰 *SALDO:* ${formatRupiah(getUserBalance(userId))}\n\n` +
                          `📈 *HARI INI:*\n` +
                          `├ Transaksi: ${today.count}\n` +
                          `├ Pemasukan: ${formatRupiah(today.income)}\n` +
                          `├ Pengeluaran: ${formatRupiah(today.expense)}\n` +
                          `└ Total: ${formatRupiah(today.total)}\n\n` +
                          `📅 *BULAN INI:*\n` +
                          `├ Pemasukan: ${formatRupiah(monthly.income)}\n` +
                          `├ Pengeluaran: ${formatRupiah(monthly.expense)}\n` +
                          `└ Total: ${formatRupiah(monthly.total)}\n\n` +
                          `💡 _Jaga keuangan, raih mimpi!_`;
            
            if (botReady) {
                await client.sendMessage(userId, report);
                // Delay antar pesan agar tidak dianggap spam
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`❌ Gagal kirim laporan ke ${userId}:`, error.message);
        }
    }
}

// ==================== INISIALISASI ====================
client.initialize();

// ==================== ERROR HANDLING ====================
process.on('unhandledRejection', (error) => {
    console.error('🚨 UNHANDLED REJECTION:', error);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    saveDatabase();
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down...');
    saveDatabase();
    client.destroy();
    process.exit(0);
});

// Auto-save setiap 5 menit
setInterval(() => {
    saveDatabase();
}, 5 * 60 * 1000);

console.log('🚀 Bot initialization complete');
console.log('🔧 Waiting for WhatsApp authentication...');
