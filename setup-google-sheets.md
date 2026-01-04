# 📊 SETUP GOOGLE SHEETS AUTO SYNC

## 1. Buat Google Cloud Project
1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project baru: `WhatsApp-Bot-Keuangan`
3. Enable **Google Sheets API**

## 2. Buat Service Account
1. Di Cloud Console → IAM & Admin → Service Accounts
2. Create Service Account → Beri nama: `whatsapp-bot-sa`
3. Create Key → JSON → Download `credentials.json`

## 3. Buat Google Sheet
1. Buka [Google Sheets](https://sheets.google.com)
2. Buat sheet baru: `Keuangan Bot WhatsApp`
3. Share sheet ke **email service account**
4. Copy **Sheet ID** dari URL:
