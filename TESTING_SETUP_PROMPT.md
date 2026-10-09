# 🧪 Generic Test Assets & Preparation Guide for Open Design AI Testing

> **Purpose**: Use this prompt and setup script on **ANY web application** you want to test with Open Design AI's Autonomous Testing Simulator.

---

## 📋 Pre-Testing Preparation Overview

Before launching an autonomous crawl or end-to-end workflow test, prepare your target app with:

1. **Test Upload Directory (`test-files/` or `fixtures/`)**: Contains dummy documents, spreadsheets, images, and notes so the AI bot can test file upload inputs without crashing.
2. **Dedicated Test Accounts**: Credentials with predictable test roles (e.g. Admin, Client/User).
3. **Dedicated Port / Local URL**: Typically `http://localhost:3001` (or your staging URL).
4. **(Optional) Postman Collection v2.1**: For immediate multi-signal route and action discovery.

---

## ⚡ 1. Generate Universal Test Files (Copy & Paste)

Run this one-liner in the root directory of **any target web application** (PowerShell or Bash with Node.js installed). It generates dummy files in a standard `test-files/` directory:

### PowerShell / Windows:
```powershell
node -e "
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'test-files');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function makePdf(title, subtitle, body) {
  const content = 'BT\n/F1 16 Tf\n50 720 Td\n(' + title + ') Tj\n/F1 12 Tf\n0 -28 Td\n(' + subtitle + ') Tj\n/F1 10 Tf\n0 -24 Td\n(' + body + ') Tj\nET';
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

// 1. PDF Documents
fs.writeFileSync(path.join(dir, 'sample-document.pdf'), makePdf('SAMPLE VERIFICATION DOCUMENT', 'Automated QA Testing Asset', 'This document is generated for autonomous file upload tests.'));
fs.writeFileSync(path.join(dir, 'sample-invoice.pdf'), makePdf('TEST INVOICE #1001', 'Total Due: USD 250.00', 'Status: Paid | Date: 2026-10-09'));

// 2. CSV Spreadsheets
fs.writeFileSync(path.join(dir, 'sample-data.csv'), 'id,name,category,amount,status,date\n1,Item Alpha,Hardware,150.00,Active,2026-10-01\n2,Item Beta,Software,99.00,Pending,2026-10-02\n3,Item Gamma,Services,45.00,Completed,2026-10-03\n');

// 3. Images
fs.writeFileSync(path.join(dir, 'sample-avatar.png'), png);
fs.writeFileSync(path.join(dir, 'sample-photo.png'), png);

// 4. Text Notes
fs.writeFileSync(path.join(dir, 'sample-notes.txt'), 'Sample testing notes and input data.\nGenerated for autonomous browser QA tests.\n');

console.log('✅ Universal test files ready in test-files/');
"
```

### macOS / Linux:
```bash
node -e '
const fs = require("fs");
const path = require("path");
const dir = path.join(process.cwd(), "test-files");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function makePdf(title, subtitle, body) {
  const content = `BT\n/F1 16 Tf\n50 720 Td\n(${title}) Tj\n/F1 12 Tf\n0 -28 Td\n(${subtitle}) Tj\n/F1 10 Tf\n0 -24 Td\n(${body}) Tj\nET`;
  const len = Buffer.byteLength(content, "utf8");
  let pdf = "%PDF-1.4\n";
  const offs = [];
  function add(s) { offs.push(Buffer.byteLength(pdf, "utf8")); pdf += s + "\n"; }
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  add("3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj");
  add("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
  add(`5 0 obj\n<< /Length ${len} >>\nstream\n${content}\nendstream\nendobj`);
  const sx = Buffer.byteLength(pdf, "utf8");
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  offs.forEach(o => { pdf += `${String(o).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${sx}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

fs.writeFileSync(path.join(dir, "sample-document.pdf"), makePdf("SAMPLE DOCUMENT", "QA Test Asset", "Generated for autonomous upload tests."));
fs.writeFileSync(path.join(dir, "sample-data.csv"), "id,name,amount\n1,Alpha,100\n2,Beta,200\n");
fs.writeFileSync(path.join(dir, "sample-avatar.png"), png);
fs.writeFileSync(path.join(dir, "sample-notes.txt"), "QA test notes.\n");
console.log("✅ Universal test files ready in test-files/");
'
```

---

## 🚀 2. Launching Your Target App

Start your application on a known local port (e.g. `3001` to avoid conflicting with Open Design AI on `3000`):

```bash
# Example Next.js / Vite / Express app:
PORT=3001 npm run dev
# or
npx next dev -p 3001
```

---

## 🎯 3. Running the AI Simulator

1. Navigate to Open Design AI: [http://localhost:3000/ai-simulator](http://localhost:3000/ai-simulator).
2. Enter your **Target URL**: e.g., `http://localhost:3001`.
3. In the **AI Testing Bot Dock**:
   - Set **Upload Files Directory**: `test-files`
   - Set **Test Credentials**: (if your app requires authentication)
   - Enable/disable Safety Guards (destructive action prevention, test payment authorization)
4. Choose your testing mode:
   - **Full App Systematic Testing**: Automatically maps all reachable screens, generates an action plan, and executes complete UI journeys.
   - **Targeted Workflow Testing**: Enter a natural language goal like *"Test user registration and file upload flow"*.
5. Inspect the live console trace, coverage metrics, and visual screenshot evidence!
