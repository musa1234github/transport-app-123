const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '24.03.2026  MANIKGARH.xlsx');
try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  console.log("=== EXCEL DATA SNAPSHOT ===");
  rows.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i}:`, row);
  });
  console.log("===========================");
} catch (e) {
  console.error("Error reading excel:", e);
}
