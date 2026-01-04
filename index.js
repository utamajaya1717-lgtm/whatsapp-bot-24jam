// ================ AWAL FILE ================
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ================ KONFIGURASI ================
const PREFIX = '!';
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '+6281234567890';
const adminWhatsAppID = ADMIN_NUMBER.includes('@') 
    ? ADMIN_NUMBER 
    : `${ADMIN_NUMBER.replace(/[^0-9]/g, '')}@c.us`;

const app = express();
const PORT = process.env.PORT || 3000;

// ================ DATABASE ================
const DB_PATH = path.join(__dirname, 'data.json');
let database = {
    users: {},
    transactions: [],
    balances: {},
    settings: {}
};

if (fs.existsSync(DB_PATH)) {
    try {
        database = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        console.log('✅ Database loaded');
    } catch (e) {
        console.log('⚠️ Database corrupt, using fresh database');
    }
}

function saveDatabase() {
    fs.writeFileSync(DB_PATH, JSON.stringify(database, null, 2));
}

// ================ WHATSAPP CLIENT ================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot-keuangan",
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

// ================ WEB SERVER ================
app.get('/', (req, res) => {
