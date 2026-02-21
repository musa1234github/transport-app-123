/**
 * ══════════════════════════════════════════════════════════════════
 *  ONE-TIME MIGRATION: BillTable.GSTUpdateDate → PaymentTable
 *  Uses Firebase ADMIN SDK (bypasses Firestore security rules)
 * ══════════════════════════════════════════════════════════════════
 *
 *  BEFORE RUNNING — get your service account key:
 *    1. Go to: https://console.firebase.google.com/project/transport-app-c4674/settings/serviceaccounts/adminsdk
 *    2. Click "Generate new private key" → Download JSON
 *    3. Save it as:  scripts/serviceAccountKey.json
 *    4. Run:  node scripts/migrate-gst-to-payment-table.mjs
 *
 *  SAFE TO RE-RUN: docs that already have GSTUpdateDate are skipped.
 *  Set OVERWRITE = true to force-overwrite existing values.
 * ══════════════════════════════════════════════════════════════════
 */

import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Verify service account key exists ────────────────────────────
const keyPath = path.join(__dirname, "serviceAccountKey.json");
if (!existsSync(keyPath)) {
    console.error(`
❌  SERVICE ACCOUNT KEY NOT FOUND!

Please follow these steps:
  1. Open: https://console.firebase.google.com/project/transport-app-c4674/settings/serviceaccounts/adminsdk
  2. Click "Generate new private key" and download the JSON file.
  3. Rename it to: serviceAccountKey.json
  4. Move it to:   e:\\React-App\\transport-app-123\\scripts\\serviceAccountKey.json
  5. Run this script again.
`);
    process.exit(1);
}

// ── Load firebase-admin via require (CJS module) ─────────────────
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Options ───────────────────────────────────────────────────────
// Set to true to overwrite PaymentTable docs that already have GSTUpdateDate
const OVERWRITE = false;

// ── Helpers ───────────────────────────────────────────────────────
const toJsDate = (val) => {
    if (!val) return null;
    if (val._seconds !== undefined) return new Date(val._seconds * 1000); // Firestore Timestamp (admin)
    if (val.toDate) return val.toDate();
    const d = new Date(val);
    return isNaN(d) ? null : d;
};

const makeDateKey = (d) =>
    `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const makeKey = (factoryName, billDate, gstRaw) => {
    const d = toJsDate(billDate);
    if (!d) return null;
    const gstInt = Math.trunc(Number(gstRaw));
    if (isNaN(gstInt)) return null;
    return `${String(factoryName).trim()}__${makeDateKey(d)}__${gstInt}`;
};

// ── STEP 1: Load BillTable docs that have GSTUpdateDate ──────────
console.log("\n🔍 Loading BillTable docs ...");

const billSnap = await db.collection("BillTable").get();
const billsWithGst = billSnap.docs.filter(
    (d) => d.data().GSTUpdateDate != null
);

console.log(`   Total BillTable docs : ${billSnap.size}`);
console.log(`   Docs with GSTUpdateDate : ${billsWithGst.length}`);

if (billsWithGst.length === 0) {
    console.log("\n✅ No BillTable docs have GSTUpdateDate. Nothing to migrate. Exiting.");
    process.exit(0);
}

// Build lookup map: compositeKey → { gstUpdateDate, billDocId }
const billMap = new Map();
let skippedBill = 0;

for (const d of billsWithGst) {
    const data = d.data();
    const factoryName = data.FactoryName ?? "";
    const rawGst = data.Gst ?? data.GSTAmount ?? data.GstAmount ?? null;

    const key = makeKey(factoryName, data.BillDate, rawGst);
    if (!key) {
        console.warn(`  ⚠  BillTable ${d.id}: cannot build key (missing BillDate or GST). Skipped.`);
        skippedBill++;
        continue;
    }

    billMap.set(key, {
        gstUpdateDate: toJsDate(data.GSTUpdateDate),
        billDocId: d.id,
    });
}

console.log(`   Built ${billMap.size} keys  |  ${skippedBill} skipped\n`);

// ── STEP 2: Load ALL PaymentTable docs ───────────────────────────
console.log("🔍 Loading PaymentTable docs ...");

const paySnap = await db.collection("PaymentTable").get();
console.log(`   Found ${paySnap.size} PaymentTable docs\n`);

// ── STEP 3: Match and update ──────────────────────────────────────
let updated = 0;
let skipped = 0;
let noMatch = 0;
let errors = 0;

console.log("⚙  Matching and updating ...\n");

for (const d of paySnap.docs) {
    const data = d.data();
    const factoryName = data.FactoryName ?? "";
    const rawGst = data.Gst ?? data.GSTAmount ?? data.GstAmount ?? null;

    const key = makeKey(factoryName, data.BillDate, rawGst);

    if (!key) {
        skipped++;
        continue;
    }

    const match = billMap.get(key);

    if (!match) {
        noMatch++;
        continue;
    }

    // Already has GSTUpdateDate and OVERWRITE is off
    if (!OVERWRITE && data.GSTUpdateDate != null) {
        console.log(`  ⏭  PaymentTable ${d.id}: already has GSTUpdateDate — skipped`);
        skipped++;
        continue;
    }

    try {
        await db.collection("PaymentTable").doc(d.id).update({
            GSTUpdateDate: admin.firestore.Timestamp.fromDate(match.gstUpdateDate),
            MigratedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  ✅ Updated PaymentTable ${d.id}  ←  BillTable ${match.billDocId}  [${key}]`);
        updated++;
    } catch (err) {
        console.error(`  ❌ Failed PaymentTable ${d.id}: ${err.message}`);
        errors++;
    }
}

// ── STEP 4: Summary ──────────────────────────────────────────────
console.log(`
══════════════════════════════════════════
 MIGRATION COMPLETE
══════════════════════════════════════════
 ✅ Updated successfully : ${updated}
 ⏭  Skipped (no change)  : ${skipped}
 ❓ No match in BillTable: ${noMatch}
 ❌ Errors               : ${errors}
══════════════════════════════════════════
`);

process.exit(errors > 0 ? 1 : 0);
