/**
 * ══════════════════════════════════════════════════════════════════
 *  ADD JSW TO FACTORIES COLLECTION
 *  Uses Firebase ADMIN SDK (bypasses Firestore security rules)
 * ══════════════════════════════════════════════════════════════════
 *
 *  BEFORE RUNNING — ensure your service account key is present:
 *    scripts/serviceAccountKey.json
 *
 *  Run:  node scripts/add-jsw-factory.mjs
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

// ── Factory name to add ───────────────────────────────────────────
// Must match EXACTLY what is stored in BillTable.FactoryName for JSW bills
const JSW_FACTORY_NAME = "JSW";

console.log(`\n🏭 Adding "${JSW_FACTORY_NAME}" to the Factories collection...\n`);

try {
    const factoryDocRef = db.collection("Factories").doc(JSW_FACTORY_NAME);

    // Check if it already exists
    const existing = await factoryDocRef.get();

    if (existing.exists) {
        const data = existing.data();
        console.log(`⚠️  "${JSW_FACTORY_NAME}" already exists in Factories collection:`);
        console.log("   ", JSON.stringify(data, null, 2));

        // Ensure hasPayments is true
        if (!data.hasPayments) {
            await factoryDocRef.update({
                hasPayments: true,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`✅  Updated hasPayments → true for "${JSW_FACTORY_NAME}"`);
        } else {
            console.log(`✅  "${JSW_FACTORY_NAME}" already has hasPayments: true. No changes needed.`);
        }
    } else {
        // Create new document
        await factoryDocRef.set({
            displayName: JSW_FACTORY_NAME,
            hasPayments: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅  Successfully created "${JSW_FACTORY_NAME}" in Factories collection!`);
    }

    // ── Verify ────────────────────────────────────────────────────
    console.log("\n🔍 Verifying all factories in Factories collection...\n");
    const allFactories = await db.collection("Factories")
        .where("hasPayments", "==", true)
        .get();

    console.log(`   Total factories with hasPayments=true: ${allFactories.size}`);
    allFactories.docs.forEach(d => {
        console.log(`     ✅  ${d.data().displayName || d.id}`);
    });

    console.log(`
══════════════════════════════════════════
 DONE!
══════════════════════════════════════════
 "${JSW_FACTORY_NAME}" is now in the Factories collection.

 ⚠️  IMPORTANT: Clear the browser localStorage cache so the
     new factory appears in the dropdown immediately:
     1. Open the app in your browser
     2. Press F12 → Application → Local Storage
     3. Delete the key: "paymentFactoriesCache"
     4. Refresh the page
══════════════════════════════════════════
`);

} catch (error) {
    console.error("❌  Failed:", error.message);
    process.exit(1);
}

process.exit(0);
