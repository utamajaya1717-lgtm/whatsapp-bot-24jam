const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class GoogleSheetsHandler {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    this.sheetName = 'Keuangan';
    this.auth = null;
  }

  // 1. Setup Google Sheets API
  async authorize() {
    try {
      const credentials = JSON.parse(
        process.env.GOOGLE_CREDENTIALS || 
        fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8')
      );

      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.auth = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log('✅ Google Sheets authorized');
      return true;
    } catch (error) {
      console.error('❌ Google Sheets auth error:', error.message);
      return false;
    }
  }

  // 2. Catat transaksi ke Sheet
  async catatTransaksi(transaksi) {
    if (!this.auth) await this.authorize();
    if (!this.auth) return false;

    try {
      const values = [[
        transaksi.date,
        transaksi.time,
        transaksi.type === 'pemasukan' ? 'PEMASUKAN' : 'PENGELUARAN',
        transaksi.amount,
        transaksi.category,
        transaksi.description,
        new Date(transaksi.timestamp).toLocaleString('id-ID'),
        'WHATSAPP BOT'
      ]];

      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:H`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values }
      });

      console.log(`✅ Data saved to Google Sheets: ${transaksi.amount}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving to Google Sheets:', error.message);
      return false;
    }
  }

  // 3. Ambil data dari Sheet
  async getData(range = 'A:H') {
    if (!this.auth) await this.authorize();
    if (!this.auth) return [];

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!${range}`
      });

      return response.data.values || [];
    } catch (error) {
      console.error('❌ Error reading from Google Sheets:', error.message);
      return [];
    }
  }

  // 4. Update laporan bulanan
  async updateLaporanBulanan(laporan) {
    if (!this.auth) await this.authorize();
    if (!this.auth) return false;

    try {
      const bulan = laporan.bulan;
      const sheetLaporan = `Laporan_${bulan}`;
      
      // Buat sheet baru jika belum ada
      await this.createSheetIfNotExists(sheetLaporan);
      
      const values = [
        ['LAPORAN BULANAN', bulan],
        ['Total Pemasukan', laporan.totalPemasukan],
        ['Total Pengeluaran', laporan.totalPengeluaran],
        ['Saldo', laporan.saldo],
        ['Total Transaksi', laporan.totalTransaksi],
        [''],
        ['Kategori', 'Pemasukan', 'Pengeluaran']
      ];

      // Tambahkan data per kategori
      Object.entries(laporan.byKategori).forEach(([kategori, data]) => {
        values.push([kategori, data.pemasukan || 0, data.pengeluaran || 0]);
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetLaporan}!A1:C${values.length}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
      });

      console.log(`✅ Laporan bulanan ${bulan} updated to Google Sheets`);
      return true;
    } catch (error) {
      console.error('❌ Error updating monthly report:', error.message);
      return false;
    }
  }

  // 5. Buat sheet baru
  async createSheetIfNotExists(sheetName) {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const exists = spreadsheet.data.sheets.some(sheet => 
        sheet.properties.title === sheetName
      );

      if (!exists) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }]
          }
        });
        console.log(`✅ Created new sheet: ${sheetName}`);
      }

      return true;
    } catch (error) {
      console.error('❌ Error creating sheet:', error.message);
      return false;
    }
  }
}

module.exports = GoogleSheetsHandler;
