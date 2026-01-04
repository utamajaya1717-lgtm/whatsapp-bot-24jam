// WhatsApp Bot Simple - No Google Sheets dulu
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;

// WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-bot",
    dataPath: './session'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// WhatsApp Events
client.on('qr', (qr) => {
  console.log('QR CODE:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot READY!');
});

client.on('message', async (message) => {
  if (message.body === 'ping') {
    await message.reply('🏓 Pong! Bot aktif!');
  }
  if (message.body === 'menu') {
    await message.reply('Menu: ping, menu');
  }
});

// HTTP Routes
app.get('/', (req, res) => {
  res.send('WhatsApp Bot 24/7 Aktif!');
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', time: new Date() });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  client.initialize();
});
