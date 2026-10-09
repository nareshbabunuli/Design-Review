# AI Automation & QA Testing Preparation Guide

> **Target Project**: `D:\wamp64\www\landlord-accounting-portal`  
> **Testing Suite**: `D:\wamp64\www\design-workflow-tracker` (AI Simulator & Full App Crawler)  
> **Target URL**: `http://localhost:3001`

---

## 1. Quick Setup Prompt (Copy & Run)

If you are starting fresh on a new environment or need to regenerate all test files, run this one-line command in PowerShell:

```powershell
cd D:\wamp64\www\landlord-accounting-portal
node -e "
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'test-files');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function makePdf(title, sub, body) {
  const content = 'BT\n/F1 16 Tf\n50 720 Td\n(' + title + ') Tj\n/F1 12 Tf\n0 -28 Td\n(' + sub + ') Tj\n/F1 10 Tf\n0 -24 Td\n(' + body + ') Tj\nET';
  const len = Buffer.byteLength(content, 'utf8');
  let pdf = '%PDF-1.4\n';
  const offs = [];
  function add(s) { offs.push(Buffer.byteLength(pdf, 'utf8')); pdf += s + '\n'; }
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj');
  add('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  add('5 0 obj\n<< /Length ' + len + ' >>\nstream\n' + content + '\nendstream\nendobj');
  const sx = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  offs.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + sx + '\n%%EOF\n';
  return Buffer.from(pdf, 'utf8');
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

fs.writeFileSync(path.join(dir, 'mortgage_interest_certificate_2024_25.pdf'), makePdf('BARCLAYS MORTGAGE ANNUAL STATEMENT 2024-2025', 'Property: 14 High Street, Abingdon, OX14 5AX', 'Annual Interest: GBP 4,820.50 | Borrower: John Smith'));
fs.writeFileSync(path.join(dir, 'gas_safety_certificate_cp12.pdf'), makePdf('LANDLORD GAS SAFETY RECORD CP12', 'Property: Flat 3, Crown Court, Oxford, OX1 2AA', 'Pass Result: Safe to operate. Inspection: 12 Jan 2025'));
fs.writeFileSync(path.join(dir, 'assured_shorthold_tenancy_agreement.pdf'), makePdf('ASSURED SHORTHOLD TENANCY AGREEMENT', 'Property: 14 High Street, Abingdon, OX14 5AX', 'Rent: GBP 1,650 pcm | Tenant: Sarah Connor | Term: 12 Months'));
fs.writeFileSync(path.join(dir, 'rental_transactions_2024_2025.csv'), 'Date,Property,Type,Description,Amount_GBP,Category\n2024-05-01,\"14 High Street, Abingdon\",Income,\"Monthly Rent - Sarah Connor\",1650.00,Rental Income\n2024-05-15,\"14 High Street, Abingdon\",Expense,\"Boiler Service\",-180.00,Repairs & Maintenance\n2024-06-01,\"14 High Street, Abingdon\",Income,\"Monthly Rent - Sarah Connor\",1650.00,Rental Income\n2024-06-12,\"Flat 3, Crown Court\",Income,\"Monthly Rent - Michael Davis\",1250.00,Rental Income\n2024-06-20,\"Flat 3, Crown Court\",Expense,\"Smoke Alarm Test\",-65.00,Safety Compliance\n');
fs.writeFileSync(path.join(dir, 'landlord_tax_notes.txt'), 'LANDLORD ACCOUNTING CLIENT NOTES - 2024/25 TAX YEAR\nClient: John Smith\nProperties:\n1. 14 High Street, Abingdon (Abingdon Townhouse)\n2. Flat 3, Crown Court, Oxford (Crown Court Flat)\n');
fs.writeFileSync(path.join(dir, 'plumbing_repair_receipt.png'), png);
fs.writeFileSync(path.join(dir, 'boiler_inspection_photo.png'), png);
console.log('✅ All test files generated successfully in test-files/');
"
```

---

## 2. Seed Credentials & Test Accounts

Use these pre-configured credentials during testing:

### A. Business Owner / Accountant (Admin)
- **Role**: `admin`
- **URL**: `http://localhost:3001/admin` or `http://localhost:3001`
- **Email**: `bal@landlordaccounting.co.uk`
- **Password**: `AdminPassword2026!`
- **Capabilities**: Client management, document triage, GDPR export, chasing interval settings, system settings.

### B. Landlord Client
- **Role**: `client`
- **URL**: `http://localhost:3001/`
- **Email**: `john.smith@example.co.uk`
- **Password**: `LandlordPass2026!`
- **Capabilities**: Document upload, view properties, tax year folders, fulfill outstanding requests.

---

## 3. Database State & Reset

If you need a clean testing state before starting:

```powershell
cd D:\wamp64\www\landlord-accounting-portal
# Stop the node process if running
# Delete the SQLite database:
Remove-Item portal.db -ErrorAction SilentlyContinue

# Starting the server will auto-reseed initial properties, folders & requests
$env:PORT="3001"
node server.js
```

Seeded records created automatically:
- **1 Admin** (`bal@landlordaccounting.co.uk`)
- **1 Client** (`john.smith@example.co.uk`)
- **2 Properties** (`Abingdon Townhouse`, `Crown Court Flat`)
- **5 Tax-Year Folders** (`2024-25`, `2023-24`, Catch-all)
- **1 Outstanding Request** (`req_mortgage_2024_25` - Mortgage Interest Statement)

---

## 4. Starting the Portal for Testing

Always launch on port **3001** (which the AI Simulator targets):

```powershell
cd D:\wamp64\www\landlord-accounting-portal
$env:PORT="3001"
node server.js
```

Output should confirm:
```
Landlord Accounting Portal live at http://localhost:3001
Firm administration console live at http://localhost:3001/admin
```

---

## 5. Running the AI Simulator in Design-Workflow-Tracker

1. Open `http://localhost:3000/ai-simulator`.
2. Verify **Target URL** is set to `http://localhost:3001`.
3. In the **AI Testing Bot Dock**:
   - Set **Project**: `landlord-accounting-portal`
   - Select **Pre-Flight Testing Checklist**:
     - Upload files directory: `test-files`
     - Username: `john.smith@example.co.uk`
     - Password: `LandlordPass2026!`
4. Click **▶ Launch Autonomous Test** or **Import Postman Collection**.
5. Watch the crawler map out routes, upload documents, test form validations, and compile evidence.
